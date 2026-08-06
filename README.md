# Americas Health — local voice demo

Talk to the gate bot from your browser mic. No Twilio. Warm transfer is simulated.

## What it demonstrates

- **Gate then transfer** — fixed script steps, double insurance check, OK required before transfer
- **Canned rebuttals** — not interested / DNC / pricing / already on ACA (LLM never invents pitch)
- **Turn-taking** — commit on Deepgram `speech_final` (fast), `UtteranceEnd` only as noisy-line fallback
- **Per-step endpointing** — tighter on yes/no gates, slightly looser on consent / objections
- **Barge-in** — user speech while TTS plays kills generation + browser playback immediately
- **Ambiguity** — low confidence / mushy answers get a clarifying question instead of an assumption

## Setup

1. Copy `.env.example` → `.env` and fill keys (Deepgram, OpenRouter, ElevenLabs).
2. `npm install`
3. `npm run demo`
4. Open `http://localhost:3000` → **Start call** → allow microphone.

## Try

- Answer yes/no through the gate, then say **ok** on the transfer line.
- Interrupt mid-sentence — bot should stop talking right away.
- Say “not interested”, ask about price, or “do not call”.
- Mumble something vague — it should ask for a clear yes/no instead of advancing.
