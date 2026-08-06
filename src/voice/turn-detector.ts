/**
 * Turn detector — the latency / "robotic feel" control surface.
 *
 * Primary path: Deepgram speech_final (endpointing) → optional micro-hold → commit.
 * Fallback: UtteranceEnd when VAD never sees clean silence (noisy lines).
 * Never waits a fixed ~1s silence timer on top of that.
 */

import {
  BACKCHANNELS,
  BARGE_IN,
  type EndpointProfile,
} from "../script/endpointing.js";

export type TranscriptWord = {
  word: string;
  confidence: number;
  start?: number;
  end?: number;
};

export type TranscriptEvent = {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  confidence: number;
  words: TranscriptWord[];
};

export type TurnCommit = {
  text: string;
  confidence: number;
  reason: "speech_final" | "utterance_end" | "forced";
};

type TurnDetectorOpts = {
  profile: EndpointProfile;
  onTurn: (turn: TurnCommit) => void;
  onSpeechStart?: () => void;
  /** Called when barge-in criteria met while agent is speaking. */
  onBargeIn?: (partial: string) => void;
  isAgentSpeaking: () => boolean;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ");
}

function isBackchannel(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  if (BACKCHANNELS.has(n)) return true;
  const words = n.split(" ").filter(Boolean);
  if (words.length <= BARGE_IN.backchannelMaxWords && words.every((w) => BACKCHANNELS.has(w))) {
    return true;
  }
  return false;
}

function avgConfidence(words: TranscriptWord[], fallback: number): number {
  if (!words.length) return fallback;
  const sum = words.reduce((a, w) => a + (w.confidence ?? fallback), 0);
  return sum / words.length;
}

export class TurnDetector {
  private profile: EndpointProfile;
  private buffer = "";
  private bufferConfidence = 0;
  private committed = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private speechStartedAt: number | null = null;
  private lastBargeAt = 0;
  private sawSpeechFinal = false;
  private opts: TurnDetectorOpts;

  constructor(opts: TurnDetectorOpts) {
    this.opts = opts;
    this.profile = opts.profile;
  }

  setProfile(profile: EndpointProfile): void {
    this.profile = profile;
  }

  resetForNewTurn(): void {
    this.clearHold();
    this.buffer = "";
    this.bufferConfidence = 0;
    this.committed = false;
    this.speechStartedAt = null;
    this.sawSpeechFinal = false;
  }

  /** Deepgram SpeechStarted / VAD */
  onVadSpeechStarted(): void {
    this.speechStartedAt = Date.now();
    this.opts.onSpeechStart?.();
    this.maybeBargeIn("");
  }

  onUtteranceEnd(): void {
    if (this.committed) return;
    // Fallback only — if speech_final already handled, ignore.
    if (this.sawSpeechFinal) return;
    this.tryCommit("utterance_end");
  }

  onTranscript(ev: TranscriptEvent): void {
    const text = ev.text.trim();
    if (!text) return;

    const conf = avgConfidence(ev.words, ev.confidence);

    // While bot is talking: only barge-in — never commit a turn mid-TTS
    if (this.opts.isAgentSpeaking()) {
      this.maybeBargeIn(text, conf);
      if (ev.isFinal) {
        this.buffer = this.mergeBuffer(this.buffer, text);
        this.bufferConfidence = conf;
      }
      return;
    }

    if (!this.speechStartedAt) this.speechStartedAt = Date.now();

    if (ev.isFinal) {
      this.buffer = this.mergeBuffer(this.buffer, text);
      this.bufferConfidence = conf;
    }

    // PRIMARY: fire on speech_final immediately (not after utterance_end silence).
    if (ev.speechFinal) {
      this.sawSpeechFinal = true;
      if (ev.isFinal) {
        this.buffer = this.mergeBuffer(this.buffer, text);
        this.bufferConfidence = conf;
      }
      this.scheduleCommit("speech_final");
    }
  }

  private mergeBuffer(prev: string, next: string): string {
    if (!prev) return next;
    if (prev.endsWith(next) || prev.includes(next)) return prev;
    if (next.startsWith(prev)) return next;
    return `${prev} ${next}`.replace(/\s+/g, " ").trim();
  }

  private scheduleCommit(reason: TurnCommit["reason"]): void {
    this.clearHold();
    const hold = this.profile.postFinalHoldMs;
    if (hold <= 0) {
      this.tryCommit(reason);
      return;
    }
    this.holdTimer = setTimeout(() => this.tryCommit(reason), hold);
  }

  private tryCommit(reason: TurnCommit["reason"]): void {
    if (this.committed) return;
    const text = this.buffer.trim();
    const conf = this.bufferConfidence;

    if (text.length < this.profile.minChars) {
      this.opts.log?.("turn_drop_short", { text, reason });
      this.resetForNewTurn();
      return;
    }

    if (conf < this.profile.minConfidence) {
      this.opts.log?.("turn_drop_confidence", { text, conf, reason });
      // Still commit as low-confidence — session will clarify, not assume
      this.committed = true;
      this.opts.onTurn({ text, confidence: conf, reason });
      return;
    }

    // Backchannels alone are not turns when we expect a real answer —
    // except "ok"/"sure" on transfer consent.
    if (
      isBackchannel(text) &&
      this.profile.expect !== "ok_consent" &&
      this.profile.expect !== "yes_no" &&
      this.profile.expect !== "rapport"
    ) {
      this.opts.log?.("turn_drop_backchannel", { text, reason });
      this.resetForNewTurn();
      return;
    }

    this.committed = true;
    this.opts.log?.("turn_commit", { text, conf, reason });
    this.opts.onTurn({ text, confidence: conf, reason });
  }

  private maybeBargeIn(partial: string, conf = 1): void {
    if (!this.opts.isAgentSpeaking()) return;
    if (!this.opts.onBargeIn) return;

    const now = Date.now();
    if (now - this.lastBargeAt < BARGE_IN.cooldownMs) return;

    const started = this.speechStartedAt ?? now;
    if (now - started < BARGE_IN.minSpeechMs) return;

    if (conf < BARGE_IN.minConfidence) return;

    // Don't kill TTS for pure "uh-huh" while bot is mid-script line
    if (partial && isBackchannel(partial)) {
      this.opts.log?.("barge_ignore_backchannel", { partial });
      return;
    }

    this.lastBargeAt = now;
    this.opts.onBargeIn(partial);
  }

  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  dispose(): void {
    this.clearHold();
  }
}
