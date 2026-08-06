# Phase 3 Deep Research: Advanced Systemic Enhancements

After conducting a deep dive into `demo-session.ts`, `deepgram-stt.ts`, `lines.ts`, and `qa.ts`, I've identified several deeper, systemic bottlenecks that restrict the bot from achieving true human fluidity. 

Here is the plan for resolving them (No implementation yet, just the blueprint):

## 1. Predictive TTS Caching (File: `src/voice/demo-session.ts`)
**The Problem:** The current session warms the TTS cache at the very beginning of the call for a few static strings (like the greeting). However, mid-call branches (like objections or yes/no responses) still suffer from the API generation delay.
**The Plan:** Implement "Predictive Caching". While the bot is currently speaking a line, the system should look at the state machine's 2 or 3 most likely next steps and quietly pre-warm the TTS for those responses in the background. If the user says "Yes", the audio is already sitting in RAM and plays instantly (0ms TTFB).

## 2. Graceful "Soft Barge-In" Recovery (File: `src/voice/demo-session.ts` & `src/voice/turn-detector.ts`)
**The Problem:** The current `bargeIn()` function is extremely aggressive. If the user's dog barks or they sneeze, Deepgram might register it as speech. The bot instantly kills its TTS playback and abruptly stops talking, creating an awkward, broken interaction.
**The Plan:** Implement a "Soft Barge-In". When the user interrupts, the bot should pause its TTS stream but keep the remaining audio buffered. If the classifier determines the interruption was just noise or an unclassifiable mumble, the bot should say "Anyway..." or "As I was saying..." and seamlessly resume the rest of the sentence.

## 3. Dynamic Script Variability (File: `src/script/lines.ts`)
**The Problem:** The `SCRIPT` object contains hardcoded strings. If a user receives two calls from this system, the exact phrasing of "Hi [Name], how are you doing today?" and "This is [Rep] with Americas Health" will be identical, exposing it as a script.
**The Plan:** Convert the static string definitions into arrays of 3-4 variations (e.g., "Hey [Name], hope you're having a good day" vs. "Hi [Name], how are you doing today?"). The `fill()` function will randomly pick a variation, ensuring no two calls sound exactly alike.

## 4. Autonomous STT Reconnection (File: `src/voice/deepgram-stt.ts`)
**The Problem:** Deepgram's WebSocket is fragile over unstable internet connections. If it drops, the `DeepgramSTT` class throws an error and the call effectively breaks.
**The Plan:** Build a transparent auto-reconnect wrapper around the Deepgram socket. If the connection drops during a period of silence, it should silently re-establish the socket in the background without notifying the frontend or dropping the user's call.

## 5. Expanded QA Monitoring for Tone (File: `src/monitor/qa.ts`)
**The Problem:** The QA monitor rigidly checks for specific words (like penalizing "Glad to hear it" if used out of context). This restricts how empathetic the bot can be.
**The Plan:** Introduce sentiment flagging into the `evaluateTurn` logic. If the user intent is `doing_bad` (e.g., "My dog died"), the QA monitor should enforce that the bot's response contains empathetic keywords or an explicitly lowered TTS pitch, flagging it if the bot sounds too cheerful.
