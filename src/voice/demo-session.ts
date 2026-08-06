/**
 * One browser demo session: mic → STT → turn detector → gate → streaming TTS.
 */

import { SCRIPT, STEP_LABELS } from "../script/lines.js";
import type { WebSocket } from "ws";
import { demoLead } from "../config.js";
import { GateEngine } from "../gate/engine.js";
import { appendMonitor, evaluateTurn } from "../monitor/qa.js";
import { DeepgramSTT } from "./deepgram-stt.js";
import { TtsPlayer } from "./tts.js";
import { TurnDetector, type TurnCommit } from "./turn-detector.js";

type ClientMsg = { type: "start" } | { type: "stop" } | { type: "playback_done" };

/** No user reply after bot finishes → nudge, then hang up. */
const RESPONSE_WAIT_MS = 5_000;

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function log(msg: string, meta?: Record<string, unknown>): void {
  console.log(`[demo] ${msg}`, meta ? JSON.stringify(meta) : "");
}

export class DemoSession {
  private gate = new GateEngine(demoLead());
  private tts = new TtsPlayer();
  private stt: DeepgramSTT | null = null;
  private turns: TurnDetector | null = null;
  private busy = false;
  private ended = false;
  private gen = 0;
  private clientPlaying = false;
  /** 0 = waiting for first reply; 1 = already asked "still there?" */
  private silenceStage = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingReply = false;

  constructor(private ws: WebSocket) {}

  async start(): Promise<void> {
    const profile = this.gate.profile();
    this.turns = new TurnDetector({
      profile,
      isAgentSpeaking: () => this.tts.isSpeaking() || this.clientPlaying,
      onTurn: (t) => void this.onUserTurn(t),
      onBargeIn: () => this.bargeIn(),
      log,
    });

    this.stt = new DeepgramSTT(profile, {
      onTranscript: (ev) => {
        if (ev.text) {
          send(this.ws, {
            type: "partial",
            text: ev.text,
            final: ev.isFinal,
            speechFinal: ev.speechFinal,
            confidence: ev.confidence,
          });
        }
        this.turns?.onTranscript(ev);
      },
      onSpeechStarted: () => {
        // Pause the no-reply clock while they're talking
        this.clearSilenceTimer();
        this.turns?.onVadSpeechStarted();
      },
      onUtteranceEnd: () => {
        if (!this.tts.isSpeaking() && !this.clientPlaying) {
          this.turns?.onUtteranceEnd();
          // No committed turn yet — keep waiting for a reply
          this.armSilenceWait();
        }
      },
      onError: (e) => {
        const message = e.message || String(e);
        log("stt_error", { message });
        // Don't paint the whole call "Error" for transient socket noise after open
        if (/timed out|unauthorized|401|403|invalid|policy/i.test(message)) {
          send(this.ws, { type: "error", message: `STT: ${message}` });
        } else {
          send(this.ws, { type: "warn", message: `STT: ${message}` });
        }
      },
      log,
    });

    try {
      await this.stt.start();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log("stt_start_failed", { message });
      send(this.ws, { type: "error", message: `STT failed to start: ${message}` });
      throw e;
    }

    // Warm opening + common short Qs while UI gets ready (cuts first-reply lag)
    const open = this.gate.openingLine();
    void this.tts.warm(open.say);
    void this.tts.warm("Have you gotten that free health subsidy yet?");
    void this.tts.warm("I'm good, thanks.");
    void this.tts.warm(SCRIPT.areYouThere);
    void this.tts.warm(SCRIPT.silenceHangup);

    send(this.ws, {
      type: "ready",
      step: this.gate.step,
      stepLabel: STEP_LABELS[this.gate.step],
      lead: demoLead(),
    });
    await this.speakAction(open);
  }

  onAudio(chunk: Buffer): void {
    this.stt?.sendAudio(chunk);
  }

  onClientJson(raw: string): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (msg.type === "stop") this.close();
    if (msg.type === "playback_done") {
      this.clientPlaying = false;
      // Clock starts when the lead can hear the question end
      this.armSilenceWait();
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private armSilenceWait(): void {
    this.clearSilenceTimer();
    if (this.ended || this.busy || !this.awaitingReply) return;
    if (this.tts.isSpeaking() || this.clientPlaying) return;
    if (this.gate.step === "ended" || this.gate.step === "transferring" || this.gate.step === "dnc") {
      return;
    }

    log("silence_arm", { stage: this.silenceStage, ms: RESPONSE_WAIT_MS });
    this.silenceTimer = setTimeout(() => void this.onSilenceTimeout(), RESPONSE_WAIT_MS);
  }

  private async onSilenceTimeout(): Promise<void> {
    this.silenceTimer = null;
    if (this.ended || this.busy) return;
    if (this.tts.isSpeaking() || this.clientPlaying) {
      this.armSilenceWait();
      return;
    }

    this.busy = true;
    this.awaitingReply = false;
    const myGen = this.gen;

    try {
      if (this.silenceStage === 0) {
        this.silenceStage = 1;
        log("silence_nudge");
        send(this.ws, {
          type: "qa",
          intent: "other",
          confidence: 1,
          flags: ["silence_nudge"],
          notes: ["No reply for 5s — asking if still there"],
          decideMs: 0,
          step: this.gate.step,
        });
        if (myGen !== this.gen) return;
        await this.speakAction(this.gate.silenceNudge());
      } else {
        log("silence_hangup");
        send(this.ws, {
          type: "qa",
          intent: "other",
          confidence: 1,
          flags: ["silence_hangup"],
          notes: ["No reply after nudge — hanging up"],
          decideMs: 0,
          step: this.gate.step,
        });
        if (myGen !== this.gen) return;
        await this.speakAction(this.gate.silenceHangup());
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log("silence_error", { message });
      send(this.ws, { type: "error", message });
    } finally {
      this.busy = false;
      this.turns?.resetForNewTurn();
    }
  }

  private bargeIn(): void {
    if (!this.tts.isSpeaking() && !this.clientPlaying) return;
    log("barge_in");
    this.clearSilenceTimer();
    this.awaitingReply = false;
    this.gen += 1;
    this.tts.interrupt();
    this.clientPlaying = false;
    send(this.ws, { type: "barge_in" });
    this.busy = false;
  }

  private async onUserTurn(turn: TurnCommit): Promise<void> {
    if (this.ended || this.busy) return;
    this.clearSilenceTimer();
    this.silenceStage = 0;
    this.awaitingReply = false;
    this.busy = true;
    const myGen = this.gen;

    send(this.ws, {
      type: "user_turn",
      text: turn.text,
      confidence: turn.confidence,
      reason: turn.reason,
    });

    try {
      const t0 = Date.now();
      const stepBefore = this.gate.step;
      const action = await this.gate.handleTurn(turn.text, turn.confidence);
      const decideMs = Date.now() - t0;

      // Speak first — logging shouldn't sit in front of audio
      send(this.ws, {
        type: "qa",
        intent: action.intent,
        confidence: action.intentConfidence,
        flags: [],
        notes: [],
        decideMs,
        step: stepBefore,
      });
      send(this.ws, { type: "decide_ms", ms: decideMs });
      log("decide_ms", { ms: decideMs, step: action.step, intent: action.intent });

      if (myGen !== this.gen) return;
      const speakPromise = this.speakAction(action);

      const qa = evaluateTurn({
        step: stepBefore,
        user: turn.text,
        intent: action.intent,
        intentConfidence: action.intentConfidence,
        bot: action.say,
      });
      appendMonitor({
        at: new Date().toISOString(),
        step: stepBefore,
        user: turn.text,
        intent: action.intent,
        intentConfidence: action.intentConfidence,
        bot: action.say,
        flags: qa.flags,
        notes: qa.notes,
        decideMs,
      });
      send(this.ws, {
        type: "qa",
        intent: action.intent,
        confidence: action.intentConfidence,
        flags: qa.flags,
        notes: qa.notes,
        decideMs,
        step: stepBefore,
      });

      await speakPromise;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log("turn_error", { message });
      send(this.ws, { type: "error", message });
    } finally {
      this.busy = false;
      this.turns?.resetForNewTurn();
    }
  }

  private async speakAction(action: {
    say: string;
    step: string;
    endpoint: import("../script/endpointing.js").EndpointProfile;
    transfer?: boolean;
    end?: boolean;
  }): Promise<void> {
    const myGen = this.gen;
    this.clearSilenceTimer();
    this.awaitingReply = false;
    this.turns?.setProfile(action.endpoint);
    await this.stt?.updateProfile(action.endpoint);

    send(this.ws, {
      type: "bot_say",
      text: action.say,
      step: action.step,
      stepLabel: STEP_LABELS[action.step as keyof typeof STEP_LABELS] ?? action.step,
      transfer: Boolean(action.transfer),
      end: Boolean(action.end),
      endpoint: {
        endpointingMs: action.endpoint.endpointingMs,
        utteranceEndMs: action.endpoint.utteranceEndMs,
        minConfidence: action.endpoint.minConfidence,
      },
    });

    this.clientPlaying = true;
    await this.tts.speak(action.say, {
      onPcm: (pcm) => {
        if (myGen !== this.gen) return;
        if (this.ws.readyState === this.ws.OPEN) this.ws.send(pcm);
      },
      onDone: () => {
        if (myGen !== this.gen) return;
        send(this.ws, { type: "bot_done" });
        // Playback may still be draining in the browser
      },
      onError: (e) => {
        this.clientPlaying = false;
        log("tts_error", { message: e.message });
        send(this.ws, { type: "error", message: `TTS: ${e.message}` });
      },
    });

    if (action.transfer) {
      send(this.ws, {
        type: "transfer",
        message: "Warm transfer (demo) — would dial live agent here.",
      });
      this.awaitingReply = false;
      this.clearSilenceTimer();
    }
    if (action.end) {
      this.ended = true;
      this.clearSilenceTimer();
      this.awaitingReply = false;
      send(this.ws, { type: "ended" });
      return;
    }

    // Expect a reply after the lead finishes hearing this line
    if (!action.transfer) {
      this.awaitingReply = true;
      if (!this.clientPlaying) this.armSilenceWait();
    }
  }

  close(): void {
    this.clearSilenceTimer();
    this.awaitingReply = false;
    this.tts.interrupt();
    this.turns?.dispose();
    this.stt?.close();
    this.ended = true;
  }
}
