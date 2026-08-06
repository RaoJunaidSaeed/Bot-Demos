/**
 * Fast local-first intent classifier.
 * Clarification intents are matched BEFORE greetings/mood to avoid wrong lead-ins.
 */

import OpenAI from "openai";
import { z } from "zod";
import { env } from "../config.js";
import type { GateStep } from "../script/lines.js";

export const IntentSchema = z.enum([
  "yes",
  "no",
  "ok",
  "greeting_back",
  "doing_well",
  "doing_ok",
  "doing_bad",
  "not_interested",
  "dnc",
  "pricing",
  "has_aca",
  "has_medicare",
  "has_medicaid",
  "has_work_insurance",
  "who_calling",
  "why_calling",
  "what_is_this",
  "how_got_number",
  "wrong_person",
  "callback",
  "busy",
  "scam_or_legit",
  "privacy_pushback",
  "already_covered",
  "frustrated_calls",
  "want_hangup",
  "maybe",
  "repeat",
  "ambiguous",
  "other",
]);

export type Intent = z.infer<typeof IntentSchema>;

export type ClassifyResult = {
  intent: Intent;
  confidence: number;
};

const SYSTEM = `Classify ACA gate-call intent. JSON: {"intent":"...","confidence":0-1}
"I don't know" alone => maybe (NOT no).
"I don't know what you're talking about" / "what is this about" => what_is_this.
"Who is it?" / "Who are you?" / "Who's this?" => who_calling.
"I don't think so" => no.
keep calling / calling again => frustrated_calls.
hang up / end call => want_hangup.
why asking again => already_covered.
why should I tell you => privacy_pushback.
Prefer ambiguous over guessing yes/no.`;

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Americas Health Voice Demo",
  },
});

export function tryLocalIntent(text: string, step: GateStep): ClassifyResult | null {
  const t = text.trim().toLowerCase().replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ");

  if (/\b(do not call|don't call|dont call|remove me|take me off|stop calling|dnc)\b/.test(t)) {
    return { intent: "dnc", confidence: 0.96 };
  }
  if (
    /\b(hang up|i('?m| am) (gonna|going to|should) hang|end (this )?call|goodbye|bye bye)\b/.test(t)
  ) {
    return { intent: "want_hangup", confidence: 0.92 };
  }
  if (/\b(not interested|no thanks|no thank you|leave me alone|don't bother|dont bother)\b/.test(t)) {
    return { intent: "not_interested", confidence: 0.92 };
  }

  // "Who is it?" — early, before mood / maybe / LLM
  if (
    /\b(who (is it|is this|are you|am i (speaking|talking) (to|with)|'?s calling|called)|who'?s this|who'?s there|who'?s calling|whom am i speaking)\b/.test(
      t,
    ) ||
    /^who('?s| is) it\??$/.test(t) ||
    /^who are you\??$/.test(t)
  ) {
    return { intent: "who_calling", confidence: 0.96 };
  }

  // Frustrated about repeated calls — before "no" / "don't"
  if (
    /\b(keep calling|calling (me )?(again|over and over)|you people|stop calling|always calling|call(ing)? me again)\b/.test(
      t,
    ) ||
    /\bwhy (are you|do you|you) (people )?keep\b/.test(t)
  ) {
    return { intent: "frustrated_calls", confidence: 0.93 };
  }

  if (
    /\b(why (are you|do you) ask(ing)? (me )?again|asked (me )?already|asking (me )?again)\b/.test(t)
  ) {
    return { intent: "already_covered", confidence: 0.92 };
  }

  // Confused about the topic — EXPLAIN (before bare "I don't know" → maybe)
  if (
    /\b(don'?t know what (you'?re|you are) talking about|what (are you|you) talking about|no idea what (you|this)|what('?s| is) this (even )?about)\b/.test(
      t,
    ) ||
    /\bi don'?t know what you\b/.test(t)
  ) {
    return { intent: "what_is_this", confidence: 0.95 };
  }

  // "I don't know" alone — NOT the confuse-about-topic case above
  if (
    /^(uh+[,.]?\s*)?(i )?don'?t know\.?$/.test(t) ||
    /^(i'?m )?not sure\.?$/.test(t) ||
    (/\b(i don'?t know|not sure|no idea)\b/.test(t) &&
      !/\b(what|who|why|medicare|medicaid|talking about)\b/.test(t))
  ) {
    return { intent: "maybe", confidence: 0.92 };
  }

  // Clarifications / didn't hear
  if (
    /\b(what (are you|did you) (asking|saying)|say (that|it) again|repeat (that|please)?|can'?t hear|cant hear|didn'?t (catch|hear|understand)|don'?t know what you said|come again|speak up|louder|pardon)\b/.test(
      t,
    ) ||
    /^(what|huh)\??$/.test(t) ||
    /^sorry[,.]?\s*(what|huh|say)/.test(t)
  ) {
    return { intent: "repeat", confidence: 0.95 };
  }

  if (
    /\b(which subsidy|what subsidy|what (kind|type) of subsidy|subsidy are you talking|talking about|which free|free health (government )?subsidy|what (will you|do you) want)\b/.test(
      t,
    ) ||
    /\b(what (is|does) (this|that|it)|explain|tell me (more|about)|what program)\b/.test(t)
  ) {
    return { intent: "what_is_this", confidence: 0.93 };
  }

  if (
    /\b(why (should|would|do) (i|they|we|someone|anybody) (tell|give|answer|share)|none of your business|don'?t (have to|need to) (tell|answer)|why do you (need|want) (to know|that|my)|i'?m not (telling|answering)|personal (question|info)|that'?s private)\b/.test(
      t,
    )
  ) {
    return { intent: "privacy_pushback", confidence: 0.95 };
  }

  if (/\b(how much|cost|price|premium|pricing|monthly payment)\b/.test(t)) {
    return { intent: "pricing", confidence: 0.9 };
  }
  if (/\b(scam|legit|legitimate|real|fraud|spam)\b/.test(t)) {
    return { intent: "scam_or_legit", confidence: 0.9 };
  }
  if (/\b(already (told|said|answered)|i (just )?said that|i answered)\b/.test(t)) {
    return { intent: "already_covered", confidence: 0.9 };
  }
  if (/\b(already (have an agent|working with someone|doing this|have someone)|through the va|veterans affairs)\b/.test(t)) {
    return { intent: "not_interested", confidence: 0.92 };
  }
  if (/\b(why (are you|you) calling|what('?s| is) this (about|call)|purpose of (this )?call)\b/.test(t)) {
    return { intent: "why_calling", confidence: 0.92 };
  }
  if (/\b(how (did|do) you get (my|this) number|where('?d| did) you get)\b/.test(t)) {
    return { intent: "how_got_number", confidence: 0.92 };
  }
  if (/\b(wrong (person|number)|isn'?t me|you have the wrong)\b/.test(t)) {
    return { intent: "wrong_person", confidence: 0.9 };
  }
  if (/\b(call (me )?back|busy right now|driving|at work|can'?t talk|bad time)\b/.test(t)) {
    return { intent: "callback", confidence: 0.9 };
  }
  if (/\b(i'?m busy|in a meeting|give me a (second|minute))\b/.test(t)) {
    return { intent: "busy", confidence: 0.88 };
  }
  if (/\b(medicare)\b/.test(t) && /\b(have|on|with|yes|i do)\b/.test(t)) {
    return { intent: "has_medicare", confidence: 0.9 };
  }
  if (/\b(medicaid)\b/.test(t) && /\b(have|on|with|yes|i do)\b/.test(t)) {
    return { intent: "has_medicaid", confidence: 0.9 };
  }
  if (/\b(work (insurance|coverage)|employer (insurance|plan)|through (my )?work|job insurance)\b/.test(t)) {
    return { intent: "has_work_insurance", confidence: 0.9 };
  }
  if (
    /\b(marketplace|obamacare|obama care|\baca\b|exchange)\b/.test(t) &&
    /\b(have|already|on|got|with)\b/.test(t)
  ) {
    return { intent: "has_aca", confidence: 0.88 };
  }

  if (
    /^(so )?(hello|hi|hey|howdy|yo)\b/.test(t) ||
    /^(hello|hi|hey)\??$/.test(t) ||
    /^(good (morning|afternoon|evening))\b/.test(t)
  ) {
    if (
      step === "how_are_you" &&
      /\b(good|great|fine|ok|okay|alright|awesome|fantastic)\b/.test(t) &&
      !/\b(not|bad|terrible)\b/.test(t)
    ) {
      return { intent: "doing_well", confidence: 0.9 };
    }
    return { intent: "greeting_back", confidence: 0.95 };
  }

  if (step === "how_are_you") {
    if (/\b(not (good|great|well|ok|okay)|bad|terrible|awful|rough|sick|tired|stressed)\b/.test(t)) {
      return { intent: "doing_bad", confidence: 0.9 };
    }
    if (/\b(good|great|fine|signed|wonderful|awesome|fantastic|perfect|excellent|amazing|can'?t complain)\b/.test(t)) {
      return { intent: "doing_well", confidence: 0.9 };
    }
    if (/\b(i'?m (doing )?well|doing well|pretty well)\b/.test(t)) {
      return { intent: "doing_well", confidence: 0.9 };
    }
    if (/\b(ok|okay|alright|all right|so[- ]so|hanging in|same old|pretty good|not bad)\b/.test(t)) {
      return { intent: "doing_ok", confidence: 0.88 };
    }
    if (/\b(how are (you|ya)|and you|yourself)\b/.test(t)) {
      // Reciprocal "how are you" - Route to greeting_back to say "I'm good, thanks."
      return { intent: "greeting_back", confidence: 0.9 };
    }
  }

  if (/\b(maybe|not sure|i think so|possibly|i guess|kind of|sort of)\b/.test(t)) {
    return { intent: "maybe", confidence: 0.88 };
  }

  // Strict no — do NOT match bare "I don't …" (that caught "I don't know why…")
  // const yes =
  //   /^(yes|yeah|yep|yup|correct|that'?s right|thats right|i do|i have|sure|absolutely|definitely)(\b|$)/.test(t) ||
  //   (/\b(yes|yeah|yep|correct)\b/.test(t) && !/\b(no|not|don'?t|dont)\b/.test(t));
  // const no =
  //   /^(no|nope|nah|negative|incorrect|none|not really|i don'?t think so|i dont think so)(\b|$)/.test(t) ||
  //   /^(no[,.]?\s+)/.test(t) ||
  //   /\b(i don'?t have|i do not have|i haven'?t|no i don'?t|nope)\b/.test(t) ||
  //   (/\b(no|nope|nah|neither)\b/.test(t) && !/\b(yes|yeah|know)\b/.test(t));
  // const ok =
  //   /^(ok|okay|alright|all right|go ahead|sounds good|please do|connect me|fine)(\b|$)/.test(t) ||
  //   /\b(go ahead|connect me|transfer me)\b/.test(t);

  // if (step === "transfer_consent") {
  //   if (ok || (yes && !no)) return { intent: "ok", confidence: 0.92 };
  //   if (no) return { intent: "no", confidence: 0.92 };
  // }

const yes =
    /^(yes|yeah|yep|yup|correct|that'?s right|thats right|i do|i have|sure|absolutely|definitely)(\b|$)/.test(t) ||
    (/\b(yes|yeah|yep|correct)\b/.test(t) && !/\b(no|not|don'?t|dont)\b/.test(t));
  
  const no =
    /^(no|nope|nah|negative|incorrect|none|not really|not yet|i don'?t think so|i dont think so)(\b|$)/.test(t) ||
    /^(no[,.]?\s+)/.test(t) ||
    /\b(i don'?t have|i do not have|i haven'?t|no i don'?t|nope)\b/.test(t) ||
    (/\b(no|nope|nah|neither)\b/.test(t) && !/\b(yes|yeah|know)\b/.test(t));
  
  const ok =
    /^(ok|okay|alright|all right|go ahead|sounds good|please do|connect me|fine)(\b|$)/.test(t) ||
    /\b(go ahead|connect me|transfer me)\b/.test(t);

  // --- START OF NEW CODE ---
  // Handle the "Double Negative" trap for the insurance checks AND pitch
  if (step === "insurance_check_1" || step === "insurance_check_2" || step === "pitch") {
    // 1. If they say "correct", "that's right", or "right", they are confirming they DON'T have insurance (or haven't gotten the subsidy). Map to NO.
    if (/\b(correct|that'?s right|thats right|right|exactly)\b/.test(t)) {
      return { intent: "no", confidence: 0.95 }; 
    }
    
    // 2. If they say "yes I don't" or "yes I haven't", map to NO.
    if (/\byes i (don'?t|haven'?t)\b/.test(t)) {
      return { intent: "no", confidence: 0.95 };
    }

    // 3. If they give a bare "yes" or "yeah", it is too ambiguous to instantly disqualify. 
    // Force the engine to reprompt them for clarification.
    if (/^(yes|yeah|yep)\s*$/.test(t)) {
      return { intent: "ambiguous", confidence: 0.90 };
    }
  }
  // --- END OF NEW CODE ---

  if (step === "transfer_consent") {
    if (ok || (yes && !no)) return { intent: "ok", confidence: 0.92 };
    if (no) return { intent: "no", confidence: 0.92 };
  }



  if (step === "how_are_you") {
    if (yes || ok) return { intent: "doing_ok", confidence: 0.85 };
    if (no) return { intent: "doing_bad", confidence: 0.8 };
  }

  if (yes && !no) return { intent: "yes", confidence: 0.93 };
  if (no && !yes) return { intent: "no", confidence: 0.93 };
  if (yes && no) return { intent: "ambiguous", confidence: 0.7 };

  return null;
}

export async function classifyIntent(
  transcript: string,
  step: GateStep,
): Promise<ClassifyResult> {
  const local = tryLocalIntent(transcript, step);
  if (local && local.confidence >= 0.8) return local;

  try {
    const res = await client.chat.completions.create({
      model: env.OPENROUTER_MODEL,
      temperature: 0,
      max_tokens: 40,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Step: ${step}\nCaller: """${transcript}"""` },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
    return {
      intent: IntentSchema.catch("ambiguous").parse(parsed.intent),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5,
    };
  } catch {
    return local ?? { intent: "ambiguous", confidence: 0.4 };
  }
}
