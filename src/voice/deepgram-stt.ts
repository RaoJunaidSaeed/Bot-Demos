/**
 * Deepgram live STT for browser mic (linear16 @ 16kHz).
 * Buffers audio until the socket is open; surfaces real error text.
 */

import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { env } from "../config.js";
import type { EndpointProfile } from "../script/endpointing.js";
import type { TranscriptEvent } from "./turn-detector.js";

export type SttHandlers = {
  onTranscript: (ev: TranscriptEvent) => void;
  onUtteranceEnd: () => void;
  onSpeechStarted: () => void;
  onError?: (err: Error) => void;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
};

function errMessage(err: unknown): string {
  if (!err) return "Unknown Deepgram error";
  if (err instanceof Error && err.message && err.message !== "[object ErrorEvent]") {
    return err.message;
  }
  const any = err as Record<string, unknown>;
  if (typeof any.message === "string" && any.message && any.message !== "[object ErrorEvent]") {
    return any.message;
  }
  if (typeof any.error === "string") return any.error;
  if (any.error && typeof (any.error as Error).message === "string") {
    return (any.error as Error).message;
  }
  if (typeof any.reason === "string") return any.reason;
  if (typeof any.description === "string") return any.description;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export class DeepgramSTT {
  private dg = createClient(env.DEEPGRAM_API_KEY);
  private connection: any = null;
  private profile: EndpointProfile;
  private handlers: SttHandlers;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private ready = false;
  private pending: Buffer[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor(profile: EndpointProfile, handlers: SttHandlers) {
    this.profile = profile;
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    await this.connect(this.profile);
  }

  async updateProfile(profile: EndpointProfile): Promise<void> {
    this.profile = profile;
  }

  sendAudio(chunk: Buffer): void {
    if (this.closed || !chunk.length) return;
    if (!this.ready || !this.connection) {
      // Hold a short buffer until Deepgram Open (avoids ErrorEvent on early send)
      this.pending.push(Buffer.from(chunk));
      if (this.pending.length > 40) this.pending.shift();
      return;
    }
    try {
      this.connection.send(chunk);
    } catch (e) {
      this.handlers.onError?.(new Error(errMessage(e)));
    }
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.pending = [];
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    try {
      this.connection?.requestClose?.();
      this.connection?.finish?.();
    } catch {
      /* ignore */
    }
    this.connection = null;
  }

  private flushPending(): void {
    if (!this.connection || !this.ready) return;
    for (const buf of this.pending) {
      try {
        this.connection.send(buf);
      } catch {
        break;
      }
    }
    this.pending = [];
  }

  private async connect(profile: EndpointProfile): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectInner(profile).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectInner(profile: EndpointProfile): Promise<void> {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.ready = false;
    try {
      this.connection?.requestClose?.();
    } catch {
      /* ignore */
    }

    const connection = this.dg.listen.live({
      model: "nova-2",
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      punctuate: true,
      smart_format: true,
      interim_results: true,
      endpointing: profile.endpointingMs,
      utterance_end_ms: Math.max(1000, profile.utteranceEndMs),
      vad_events: true,
    });

    this.connection = connection;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Deepgram connection timed out (no Open event)"));
      }, 12_000);

      connection.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timer);
        this.ready = true;
        this.handlers.log?.("stt_open", {
          endpointingMs: profile.endpointingMs,
          utteranceEndMs: profile.utteranceEndMs,
        });
        this.keepAliveTimer = setInterval(() => {
          try {
            connection.keepAlive();
          } catch {
            /* ignore */
          }
        }, 8_000);
        this.flushPending();
        resolve();
      });

      connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
        const msg = errMessage(err);
        this.handlers.log?.("stt_error_raw", { message: msg });
        // Don't reject after open — report and keep going when possible
        if (!this.ready) {
          clearTimeout(timer);
          reject(new Error(msg));
        } else {
          this.handlers.onError?.(new Error(msg));
        }
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        this.ready = false;
        this.handlers.log?.("stt_close", {});
      });
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alt = data?.channel?.alternatives?.[0];
      const text: string = alt?.transcript ?? "";
      if (!text && !data?.speech_final) return;

      const words = (alt?.words ?? []).map((w: any) => ({
        word: String(w.word ?? ""),
        confidence: Number(w.confidence ?? alt?.confidence ?? 0),
        start: w.start,
        end: w.end,
      }));

      this.handlers.onTranscript({
        text,
        isFinal: Boolean(data.is_final),
        speechFinal: Boolean(data.speech_final),
        confidence: Number(alt?.confidence ?? 0),
        words,
      });
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      this.handlers.onUtteranceEnd();
    });

    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      this.handlers.onSpeechStarted();
    });
  }
}
