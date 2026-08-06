# Chatbot Fine-Tuning Plan: Enhancing Human Realism

This document outlines the step-by-step plan for fine-tuning the chatbot to make its conversations more natural and human-like, based on the architectural documentation. 

No implementation has started yet. This serves as the roadmap.

## Phase 1: Resolving Conversational Logic & Tone (Code Updates)
These changes target specific logic flaws and unnatural hardcoded responses in the codebase.

1. **Fix the "Double Negative" Trap (`src/llm/classifier.ts`)**
   - **Current Issue:** A user replying "Yes" to "You don't have insurance, right?" causes immediate disqualification.
   - **Solution:** Add context-specific regex for the insurance check steps to map affirming the negative (e.g., "Correct", "That's right") to a `no` intent, and handle bare "Yes" as `ambiguous` to trigger a reprompt.

2. **Soften Interrogative Reprompts (`src/script/lines.ts`)**
   - **Current Issue:** The bot uses aggressive phrases like "No Medicare... right?".
   - **Solution:** Change the prompts to polite, positive requests (e.g., "Sorry, just to clarify, do you currently have...").

3. **Remove Aggressive Prefixes (`src/gate/engine.ts`)**
   - **Current Issue:** The bot prefixes clarifications with demanding phrases like "Quick yes or no —".
   - **Solution:** Remove the hardcoded prefix logic for the `ambiguous` and `other` intents to allow for natural, seamless reprompts.

4. **Streamline the "Maybe" Rebuttal (`src/script/lines.ts`)**
   - **Current Issue:** Replying with uncertainty triggers an overly wordy and repetitive fallback sequence.
   - **Solution:** Shorten the rebuttal string to "No worries if you're not entirely sure," allowing it to flow directly into the clarification question.

5. **Fix the Rapport/Greeting Mismatch (`src/script/lines.ts` & `src/llm/classifier.ts`)**
   - **Current Issue:** The bot says "I'm good, thanks" even if the user didn't ask how it was doing, which is a major AI giveaway.
   - **Solution:** Add new rapport replies like "Great" or "Gotcha" for general well-being statements, and reserve "I'm good, thanks" specifically for when the user asks "How are you?".

6. **Correct "Not Yet" Classification (`src/llm/classifier.ts`)**
   - **Current Issue:** "Not yet" is incorrectly classified as `maybe` rather than `no`.
   - **Solution:** Update the local regex pattern for the `no` intent to include "not yet".

---

## Phase 2: Advanced Architectural Enhancements
These systemic improvements go beyond basic script changes to dramatically increase the bot's human realism over the phone.

1. **Dynamic Voice Activity Detection (VAD)**
   - **Recommendation:** Implement dual-threshold endpointing. Use short thresholds (e.g., 400ms) for quick yes/no questions, and longer ones (e.g., 1200ms) for open-ended sections so the bot doesn't interrupt users who pause to think.

2. **Time-to-First-Byte (TTFB) Audio Streaming**
   - **Recommendation:** Instead of computing a full response and waiting on TTS (which causes unnatural "dead air"), immediately stream a pre-rendered token like "Gotcha" or "Hmm," while asynchronously generating the rest of the response to achieve a sub-300ms reaction time.

3. **Asynchronous Webhook Backchanneling**
   - **Recommendation:** Mask API or database latency by playing a filler audio file (e.g., "Let me just pull that up..." or typing sounds) while fetching data, preventing awkward silence.

4. **Background Acoustic Masking**
   - **Recommendation:** Inject a continuous, very low-volume background track (e.g., subtle office hum or distant chatter). Standard clean AI audio drops to digital silence when not speaking, breaking the illusion of a live call.

5. **Prosody and SSML Injection**
   - **Recommendation:** Wrap text output in Speech Synthesis Markup Language (SSML). Dynamically adjust pitch and rate based on user intent (e.g., speaking slower and deeper for empathy) and inject `<break time="300ms"/>` tags before transitions to mimic human thought gathering.
