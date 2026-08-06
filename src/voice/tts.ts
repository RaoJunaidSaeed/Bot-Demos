/**
 * Streaming ElevenLabs TTS — fast first audio + breath pauses between phrases.
 */

import { env } from "../config.js";

export type TtsHandlers = {
  onPcm: (pcm: Buffer) => void;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
};

const SAMPLE_RATE = 16_000;
/** ~180ms of silence between clauses — feels like a breath, not dead air. */
const BREATH_MS = 180;
/** Flush PCM as soon as we have ~10ms (keeps TTFB low). */
const FLUSH_BYTES = 320;

const cache = new Map<string, Buffer>();

function silencePcm(ms: number): Buffer {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000);
  return Buffer.alloc(samples * 2); // int16 mono zeros
}

/**
 * Split on sentence / clause boundaries so long lines breathe.
 * Keeps short replies as one chunk for speed.
 */
export function splitBreathPhrases(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length < 70) return [cleaned];

  // Split on . ! ? or em/en dash clause breaks, keep punctuation
  const raw = cleaned
    .split(/(?<=[.!?])\s+|(?:\s*[—–]\s*)/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Merge tiny fragments so we don't over-chop
  const out: string[] = [];
  for (const part of raw) {
    if (out.length && out[out.length - 1].length < 28) {
      out[out.length - 1] = `${out[out.length - 1]} ${part}`.trim();
    } else {
      out.push(part);
    }
  }
  return out.length ? out : [cleaned];
}

export class TtsPlayer {
  private abort: AbortController | null = null;
  private speaking = false;

  isSpeaking(): boolean {
    return this.speaking;
  }

  interrupt(): void {
    this.abort?.abort();
    this.abort = null;
    this.speaking = false;
  }

  /** Warm cache for a line so first call is instant. */
  async warm(text: string): Promise<void> {
    const phrases = splitBreathPhrases(text);
    await Promise.all(phrases.map((p) => this.fetchPcm(p, new AbortController().signal).catch(() => null)));
  }

  async speak(text: string, handlers: TtsHandlers): Promise<void> {
    this.interrupt();
    const ac = new AbortController();
    this.abort = ac;
    this.speaking = true;
    handlers.onStart?.();

    try {
      const phrases = splitBreathPhrases(text);
      for (let i = 0; i < phrases.length; i++) {
        if (ac.signal.aborted) return;

        // Breath between phrases (not before the first — that would add latency)
        if (i > 0) {
          const dynamicBreathMs = Math.floor(Math.random() * (250 - 120 + 1)) + 120;
          handlers.onPcm(silencePcm(dynamicBreathMs));
        }

        await this.streamPhrase(phrases[i], ac.signal, handlers);
      }

      if (!ac.signal.aborted) handlers.onDone?.();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (this.abort === ac) {
        this.speaking = false;
        this.abort = null;
      }
    }
  }

  private async streamPhrase(
    text: string,
    signal: AbortSignal,
    handlers: TtsHandlers,
  ): Promise<void> {
    const cached = cache.get(text);
    if (cached) {
      // Stream cache in small frames so barge-in can still cut mid-line
      const frame = 3200; // 100ms
      for (let i = 0; i < cached.length; i += frame) {
        if (signal.aborted) return;
        const end = Math.min(i + frame, cached.length - (cached.length % 2));
        if (end > i) handlers.onPcm(cached.subarray(i, end));
        // yield to event loop
        await new Promise((r) => setImmediate(r));
      }
      return;
    }

    await this.streamFromApi(text, signal, handlers);
  }

  private async fetchPcm(text: string, signal: AbortSignal): Promise<Buffer> {
    const hit = cache.get(text);
    if (hit) return hit;

    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}/stream` +
      `?output_format=pcm_16000&optimize_streaming_latency=4`;

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.7,
          style: 0.15,
          use_speaker_boost: false,
        },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    }

    const chunks: Buffer[] = [];
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) chunks.push(Buffer.from(value));
    }
    let buf = Buffer.concat(chunks);
    if (buf.length % 2) buf = buf.subarray(0, buf.length - 1);
    if (buf.length > 100 && cache.size < 80) cache.set(text, buf);
    return buf;
  }

  private async streamFromApi(
    text: string,
    signal: AbortSignal,
    handlers: TtsHandlers,
  ): Promise<void> {
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}/stream` +
      `?output_format=pcm_16000&optimize_streaming_latency=4`;

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.7,
          style: 0.15,
          use_speaker_boost: false,
        },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    }

    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ctype.includes("application/json")) {
      throw new Error(`ElevenLabs JSON: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    let pending = Buffer.alloc(0);
    let first = true;
    const collected: Buffer[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;
      if (!value?.byteLength) continue;

      const chunk = Buffer.from(value);
      if (first && chunk[0] === 0x7b) {
        throw new Error(`ElevenLabs error: ${chunk.toString("utf8").slice(0, 180)}`);
      }
      first = false;

      collected.push(chunk);
      pending = Buffer.concat([pending, chunk]);
      const even = pending.length - (pending.length % 2);
      if (even >= FLUSH_BYTES) {
        handlers.onPcm(pending.subarray(0, even));
        pending = pending.subarray(even);
      }
    }

    const even = pending.length - (pending.length % 2);
    if (even > 0 && !signal.aborted) {
      handlers.onPcm(pending.subarray(0, even));
    }

    // Cache full phrase for next time
    if (!signal.aborted && collected.length && cache.size < 80) {
      let full = Buffer.concat(collected);
      if (full.length % 2) full = full.subarray(0, full.length - 1);
      if (full.length > 100) cache.set(text, full);
    }
  }
}
