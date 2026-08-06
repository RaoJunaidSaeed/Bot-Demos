# Advanced Fine-Tuning Plan: Hyper-Realistic Voice AI

After reviewing the core systems in the `src` folder (including `engine.ts`, `turn-detector.ts`, `tts.ts`, `endpointing.ts`, and `classifier.ts`), I have identified several opportunities to push the chatbot's realism even further. 

These recommendations do not conflict with the 7 initial issues you've already resolved. They focus on the micro-interactions, latency, and dynamic variability that distinguish a human from a bot.

No implementation has started yet. Here is the blueprint for the next phase of fine-tuning:

## 1. Natural Prosody and TTS Enhancements (`src/voice/tts.ts`)
- **Dynamic Breath Timing:** Currently, the bot inserts a hardcoded `180ms` silence between clauses to simulate breaths. Humans breathe irregularly. **Plan:** Introduce a randomized variance (e.g., `120ms` to `250ms`) to the `BREATH_MS` constant. 
- **Emotional Voice Adjustments:** The ElevenLabs API call currently uses static voice settings (`stability: 0.35`, `similarity_boost: 0.7`). **Plan:** Allow the `GateEngine` to pass a `tone` parameter to the TTS player. If the user's intent is `doing_bad`, we can temporarily increase stability and lower style to sound more solemn and empathetic.
- **LLM Latency Fillers:** When `classifyIntent` falls back to the LLM (OpenRouter), there is unavoidable latency. **Plan:** Before awaiting the LLM response, immediately stream a non-committal filler token (e.g., a quiet "hmm" or a short breath sound). This masks the 1-2 second delay of the API perfectly.

## 2. Advanced Turn Detection & Barge-In (`src/voice/turn-detector.ts` & `src/script/endpointing.ts`)
- **Contextual Endpointing Variance:** The current `ENDPOINT_PROFILES` are static per step. **Plan:** If the bot detects that the user speaks slowly (based on word timings from Deepgram), we can dynamically extend the `endpointingMs` multiplier by 1.2x for the remainder of the call, preventing the bot from cutting off slow talkers.
- **Backchannel Acknowledgment:** The bot correctly ignores backchannels (like "uh-huh" or "yeah") while speaking so it doesn't interrupt itself. **Plan:** If a user backchannels frequently, the bot should occasionally add a reciprocal backchannel to its next line (e.g., starting a sentence with "Right, so...").

## 3. Conversational Memory and Variation (`src/gate/engine.ts`)
- **Dynamic Error Recovery:** When `asrConfidence` is low or an intent is missed, the bot increments `softMisses` and says "Sorry, missed that" or "Sorry, didn't catch that." If this happens twice in a row, the exact same string is repeated. **Plan:** Implement a rotational array of error prefixes (e.g., "My apologies, the line cut out," "Could you say that one more time?", "I missed that last part").
- **Contextual Silence Nudges:** `silenceNudge()` currently triggers a generic `areYouThere` string after 5 seconds of silence. **Plan:** Make the nudge contextual to the step. If they are in the `pitch` phase, say "Still with me?". If they are in `insurance_check`, say "Take your time if you need to check."

## 4. Expanding the Local Classifier (`src/llm/classifier.ts`)
- **Reducing LLM Roundtrips:** The local regex engine is incredibly fast, but misses some complex multi-word objections that currently bleed over to the LLM. **Plan:** Analyze typical LLM fallbacks and build out robust regex patterns for hyper-specific rejections (e.g., "I'm already working with someone", "I get this through the VA") to keep response times strictly under 500ms for 95% of interactions.

---
**Next Steps:**
Review this plan. Once approved, we can start implementing these files systematically, ensuring we maintain the integrity of your existing fixes.
