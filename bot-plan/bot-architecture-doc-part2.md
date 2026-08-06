# Bot Fine-Tuning - Part 2 (Human Realism)

## Issue 8: Repetitive Error Recovery on Low Confidence
**Human Perspective:** If the phone line is staticky or the user mumbles, the bot repeatedly says "Sorry, missed that." followed by the question. Hearing the exact same fallback phrase back-to-back instantly exposes that they are speaking to an AI. Real humans vary their apologies when they can't hear.
**Bot Perspective:** When the ASR (Automatic Speech Recognition) confidence drops below the threshold in `src/gate/engine.ts`, the `softMisses` counter increments and the bot returns a hardcoded array join: `["Sorry, missed that.", q]`. 

**File to modify:** `src/gate/engine.ts`
**Location:** Inside the `handleGate` function (near the bottom where `confidence < 0.55` is checked).

**Before Code:**
```typescript
    if (confidence < 0.55) {
      this.softMisses += 1;
      return this.action(join(["Sorry, missed that.", q]), intent, confidence);
    }
```

**After Code:**
```typescript
    if (confidence < 0.55) {
      this.softMisses += 1;
      const prefixes = [
        "Sorry, missed that.",
        "My apologies, the line cut out a bit.",
        "Could you say that one more time?"
      ];
      const prefix = prefixes[(this.softMisses - 1) % prefixes.length];
      return this.action(join([prefix, q]), intent, confidence);
    }
```

---

## Issue 9: Mechanical "Breathing" Intervals
**Human Perspective:** The bot speaks in slightly disjointed blocks with pauses in between. The pause between clauses feels unnaturally exact and mechanical, whereas humans breathe at irregular, varying intervals.
**Bot Perspective:** The TTS engine in `src/voice/tts.ts` splits long sentences into smaller chunks and inserts a static, hardcoded `180ms` of silence between them using the `BREATH_MS` constant.

**File to modify:** `src/voice/tts.ts`
**Location:** Inside the `speak` method where the `handlers.onPcm(silencePcm(BREATH_MS))` is called.

**Before Code:**
```typescript
        // Breath between phrases (not before the first — that would add latency)
        if (i > 0) {
          handlers.onPcm(silencePcm(BREATH_MS));
        }
```

**After Code:**
```typescript
        // Breath between phrases (not before the first — that would add latency)
        if (i > 0) {
          // Dynamic variance between 120ms and 250ms for realistic breathing
          const dynamicBreathMs = Math.floor(Math.random() * (250 - 120 + 1)) + 120;
          handlers.onPcm(silencePcm(dynamicBreathMs));
        }
```

---

## Issue 10: Generic Silence Nudges
**Human Perspective:** If the human puts the phone down or goes silent to check something, the bot rigidly asks "Are you there?" which feels scripted and pushy. A human agent would adapt to the context (e.g., if asking about insurance, a human might say "Take your time checking").
**Bot Perspective:** The `silenceNudge()` function in `src/gate/engine.ts` uses the generic `SCRIPT.areYouThere` string blindly, regardless of which `GateStep` the state machine is currently in.

**File to modify:** `src/gate/engine.ts`
**Location:** Inside the `GateEngine` class at the `silenceNudge()` method.

**Before Code:**
```typescript
  silenceNudge(): BotAction {
    return this.action(SCRIPT.areYouThere, "other", 1);
  }
```

**After Code:**
```typescript
  silenceNudge(): BotAction {
    let nudgeLine = SCRIPT.areYouThere;
    
    // Contextual nudges based on the current step
    if (this.step === "insurance_check_1" || this.step === "insurance_check_2") {
      nudgeLine = "Take your time if you need to check.";
    } else if (this.step === "pitch") {
      nudgeLine = "Still with me?";
    }
    
    return this.action(nudgeLine, "other", 1);
  }
```

---

## Issue 11: LLM Latency Gap on Common Objections
**Human Perspective:** When a user gives a slightly complex objection like "I'm already working with someone" or "I get this through the VA", the bot pauses for an unnaturally long time (1-2 seconds) before responding, breaking the illusion of a live conversation.
**Bot Perspective:** These specific phrasing patterns are missing from the local regex engine in `src/llm/classifier.ts`. Consequently, they fall back to the slow OpenRouter LLM, which introduces heavy API latency. 

**File to modify:** `src/llm/classifier.ts`
**Location:** Inside the `tryLocalIntent` function, near the `already_covered` and `not_interested` checks.

**Before Code:**
```typescript
  if (/\b(already (told|said|answered)|i (just )?said that|i answered)\b/.test(t)) {
    return { intent: "already_covered", confidence: 0.9 };
  }
```

**After Code:**
```typescript
  if (/\b(already (told|said|answered)|i (just )?said that|i answered)\b/.test(t)) {
    return { intent: "already_covered", confidence: 0.9 };
  }
  
  // Catch VA and "already have an agent" locally to bypass LLM latency
  if (/\b(already (have an agent|working with someone|doing this|have someone)|through the va|veterans affairs)\b/.test(t)) {
    return { intent: "not_interested", confidence: 0.92 };
  }
```
