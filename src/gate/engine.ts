/**
 * Intent → on-script reply. Lead-ins are intentional, never generic filler.
 * Hi/Hello: once at open; again only if the client greets.
 */

import type { LeadVars } from "../config.js";
import { classifyIntent, type Intent } from "../llm/classifier.js";
import {
  ENDPOINT_PROFILES,
  OBJECTION_ENDPOINT,
  type EndpointProfile,
} from "../script/endpointing.js";
import {
  RAPPORT,
  REBUTTALS,
  SCRIPT,
  fill,
  fullLine,
  shortQuestion,
  type GateStep,
} from "../script/lines.js";

export type BotAction = {
  say: string;
  step: GateStep;
  endpoint: EndpointProfile;
  intent: Intent;
  intentConfidence: number;
  transfer?: boolean;
  end?: boolean;
};

function join(parts: string[]): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export class GateEngine {
  step: GateStep = "how_are_you";
  private objectionMode = false;
  private softMisses = 0;
  private pitchDelivered = false;
  private hangupOffers = 0;

  constructor(private vars: LeadVars) {}

  profile(): EndpointProfile {
    if (this.objectionMode) return OBJECTION_ENDPOINT;
    return ENDPOINT_PROFILES[this.step];
  }

  openingLine(): BotAction {
    this.step = "how_are_you";
    this.softMisses = 0;
    this.pitchDelivered = false;
    this.hangupOffers = 0;
    // Opening is the one "Hi …" for the call
    return this.action(fullLine(this.step, this.vars), "other", 1);
  }

  /** After 5s silence — nudge, keep same step. */
  silenceNudge(): BotAction {
    let nudgeLine: string = SCRIPT.areYouThere;
    if (this.step === "insurance_check_1" || this.step === "insurance_check_2") {
      nudgeLine = "Take your time if you need to check.";
    } else if (this.step === "pitch") {
      nudgeLine = "Still with me?";
    }
    return this.action(nudgeLine, "other", 1);
  }

  /** After second 5s silence — hang up. */
  silenceHangup(): BotAction {
    this.step = "ended";
    return this.action(SCRIPT.silenceHangup, "other", 1, { end: true, step: "ended" });
  }

  async handleTurn(transcript: string, asrConfidence: number): Promise<BotAction> {
    if (this.step === "ended" || this.step === "transferring" || this.step === "dnc") {
      return this.action(SCRIPT.goodbye, "other", 1, { end: true, step: "ended" });
    }

    if (asrConfidence < this.profile().minConfidence) {
      this.softMisses += 1;
      const prefixes = [
        "Sorry, didn't catch that.",
        "My apologies, the line cut out a bit.",
        "Could you say that one more time?"
      ];
      const prefix = prefixes[(this.softMisses - 1) % prefixes.length];
      return this.action(
        join([prefix, shortQuestion(this.step, this.vars)]),
        "ambiguous",
        asrConfidence,
      );
    }

    const { intent, confidence } = await classifyIntent(transcript, this.step);

    if (intent === "dnc") {
      this.step = "dnc";
      return this.action(REBUTTALS.dnc, intent, confidence, { end: true });
    }

    if (this.step === "how_are_you") {
      return this.handleRapport(intent, confidence);
    }

    return this.handleGate(intent, confidence);
  }

  private handleRapport(intent: Intent, confidence: number): BotAction {
    if (intent === "not_interested") {
      this.objectionMode = true;
      return this.deliverPitch(REBUTTALS.not_interested, intent, confidence);
    }

    switch (intent) {
      case "greeting_back":
        // Client said hi/hello — only reciprocal greeting after opening Hi
        return this.deliverPitch(RAPPORT.greeting_back, intent, confidence);
      case "doing_well":
      case "yes":
      case "ok":
        return this.deliverPitch(RAPPORT.doing_well, intent, confidence);
      case "doing_ok":
        return this.deliverPitch(RAPPORT.doing_ok, intent, confidence);
      case "doing_bad":
      case "no":
        return this.deliverPitch(RAPPORT.doing_bad, intent, confidence);
      case "busy":
      case "callback":
        return this.deliverPitch(RAPPORT.busy, intent, confidence);
      case "who_calling":
        // Answer who, then continue rapport — don't dump full pitch twice
        return this.action(
          join([fill(REBUTTALS.who_calling, this.vars), "How are you doing today?"]),
          intent,
          confidence,
        );
      case "why_calling":
        return this.deliverPitch(RAPPORT.why_first, intent, confidence);
      case "what_is_this":
        // They don't know what you mean — explain, then ask how they are (don't say "I'm good")
        return this.action(
          join([
            fill(REBUTTALS.who_calling, this.vars),
            REBUTTALS.what_is_this,
            "How are you doing today?",
          ]),
          intent,
          confidence,
        );
      case "frustrated_calls":
        return this.deliverPitch(RAPPORT.why_first, intent, confidence);
      case "how_got_number":
        return this.deliverPitch(REBUTTALS.how_got_number, intent, confidence);
      case "scam_or_legit":
        return this.deliverPitch(REBUTTALS.scam_or_legit, intent, confidence);
      case "wrong_person":
        return this.action(fill(REBUTTALS.wrong_person, this.vars), intent, confidence);
      case "want_hangup":
        return this.handleHangup(intent, confidence, true);
      case "repeat":
        return this.action(
          join(["Sure —", shortQuestion(this.step, this.vars)]),
          intent,
          confidence,
        );
      case "privacy_pushback":
        return this.deliverPitch(REBUTTALS.privacy_pushback, intent, confidence);
      case "maybe":
        return this.deliverPitch(REBUTTALS.maybe, intent, confidence);
      default:
        this.softMisses += 1;
        if (this.softMisses >= 2) {
          return this.deliverPitch(RAPPORT.fallback, intent, confidence);
        }
        return this.action(
          join(["Sorry, missed that.", shortQuestion(this.step, this.vars)]),
          intent,
          confidence,
        );
    }
  }

  private handleGate(intent: Intent, confidence: number): BotAction {
    const q = shortQuestion(this.step, this.vars);

    switch (intent) {
      case "repeat":
        this.softMisses = 0;
        return this.action(join(["Yeah —", q]), intent, confidence);

      case "greeting_back":
        return this.action(join(["Hello —", q]), intent, confidence);

      case "who_calling":
        // Clear identity — then back to the current question (no "ballpark yes or no")
        return this.action(
          join([
            fill(REBUTTALS.who_calling, this.vars),
            "Call's recorded.",
            q,
          ]),
          intent,
          confidence,
        );

      case "why_calling":
        return this.action(join([REBUTTALS.why_calling, q]), intent, confidence);

      case "frustrated_calls":
        return this.action(join([REBUTTALS.frustrated_calls, q]), intent, confidence);

      case "want_hangup":
        return this.handleHangup(intent, confidence, false);

      case "what_is_this":
        // Actually explain — this is "I don't know what you're talking about"
        return this.action(join([REBUTTALS.what_is_this, q]), intent, confidence);

      case "how_got_number":
        return this.action(join([REBUTTALS.how_got_number, q]), intent, confidence);

      case "scam_or_legit":
        return this.action(join([REBUTTALS.scam_or_legit, q]), intent, confidence);

      case "privacy_pushback":
        this.objectionMode = true;
        return this.action(join([REBUTTALS.privacy_pushback, q]), intent, confidence);

      case "already_covered":
        return this.action(join([REBUTTALS.already_covered, q]), intent, confidence);

      case "maybe":
        return this.action(join([REBUTTALS.maybe, q]), intent, confidence);

      case "wrong_person":
        return this.action(fill(REBUTTALS.wrong_person, this.vars), intent, confidence);

      case "callback":
      case "busy":
        return this.action(join([REBUTTALS.busy_gate, q]), intent, confidence);

      case "not_interested":
        this.objectionMode = true;
        return this.action(join([REBUTTALS.not_interested, q]), intent, confidence);

      case "pricing":
        this.objectionMode = true;
        return this.action(join([REBUTTALS.pricing, q]), intent, confidence);

      case "has_aca":
        this.objectionMode = true;
        if (this.step === "pitch") {
          this.step = "insurance_check_1";
          this.softMisses = 0;
          return this.action(
            join([REBUTTALS.has_aca, shortQuestion(this.step, this.vars)]),
            intent,
            confidence,
          );
        }
        return this.action(join([REBUTTALS.has_aca, q]), intent, confidence);

      case "has_medicare":
        this.step = "disqualified";
        return this.action(REBUTTALS.has_medicare, intent, confidence, { end: true });

      case "has_medicaid":
        this.step = "disqualified";
        return this.action(REBUTTALS.has_medicaid, intent, confidence, { end: true });

      case "has_work_insurance":
        this.step = "disqualified";
        return this.action(REBUTTALS.has_work_insurance, intent, confidence, { end: true });

      case "doing_well":
      case "doing_ok":
      case "doing_bad":
        return this.action(join(["Okay.", q]), intent, confidence);

      case "ambiguous":
      case "other":
        this.softMisses += 1;
        return this.action(
          q,
          intent,
          confidence,
        );

      default:
        break;
    }

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

    this.objectionMode = false;
    this.softMisses = 0;
    return this.advance(intent, confidence);
  }

  private handleHangup(intent: Intent, confidence: number, inRapport: boolean): BotAction {
    this.hangupOffers += 1;
    if (this.hangupOffers >= 2) {
      this.step = "ended";
      return this.action(SCRIPT.goodbye, intent, confidence, { end: true });
    }
    if (inRapport) {
      return this.deliverPitch(REBUTTALS.want_hangup, intent, confidence);
    }
    return this.action(
      join([REBUTTALS.want_hangup, shortQuestion(this.step, this.vars)]),
      intent,
      confidence,
    );
  }

  private deliverPitch(ack: string, intent: Intent, confidence: number): BotAction {
    this.step = "pitch";
    this.softMisses = 0;
    this.objectionMode = false;
    this.pitchDelivered = true;
    const pitch = fullLine("pitch", this.vars);
    return this.action(join([ack, pitch]), intent, confidence);
  }

  private advance(intent: Intent, confidence: number): BotAction {
    switch (this.step) {
      case "pitch":
        if (intent === "yes" || intent === "no" || intent === "ok") {
          this.step = "insurance_check_1";
          return this.action(fullLine(this.step, this.vars), intent, confidence);
        }
        return this.action(shortQuestion(this.step, this.vars), intent, confidence);

      case "insurance_check_1":
        if (intent === "no") {
          this.step = "state_confirm";
          return this.action(fullLine(this.step, this.vars), intent, confidence);
        }
        if (intent === "yes") {
          this.step = "disqualified";
          return this.action(SCRIPT.disqualified, intent, confidence, { end: true });
        }
        return this.action(shortQuestion(this.step, this.vars), intent, confidence);

      case "state_confirm":
        if (intent === "yes" || intent === "ok") {
          this.step = "insurance_check_2";
          return this.action(fullLine(this.step, this.vars), intent, confidence);
        }
        if (intent === "no") {
          this.step = "ended";
          return this.action(SCRIPT.stateMismatch, intent, confidence, { end: true });
        }
        return this.action(shortQuestion(this.step, this.vars), intent, confidence);

      case "insurance_check_2":
        if (intent === "no") {
          this.step = "transfer_consent";
          return this.action(fullLine(this.step, this.vars), intent, confidence);
        }
        if (intent === "yes") {
          this.step = "disqualified";
          return this.action(SCRIPT.disqualified, intent, confidence, { end: true });
        }
        return this.action(shortQuestion(this.step, this.vars), intent, confidence);

      case "transfer_consent":
        if (intent === "ok" || intent === "yes") {
          this.step = "transferring";
          return this.action(SCRIPT.transferring, intent, confidence, {
            transfer: true,
            end: true,
          });
        }
        if (intent === "no") {
          this.step = "ended";
          return this.action(SCRIPT.goodbye, intent, confidence, { end: true });
        }
        return this.action(shortQuestion(this.step, this.vars), intent, confidence);

      default:
        return this.action(SCRIPT.goodbye, intent, confidence, { end: true, step: "ended" });
    }
  }

  private action(
    text: string,
    intent: Intent,
    intentConfidence: number,
    opts: { end?: boolean; transfer?: boolean; step?: GateStep } = {},
  ): BotAction {
    void this.pitchDelivered;
    return {
      say: text,
      step: opts.step ?? this.step,
      endpoint: this.profile(),
      intent,
      intentConfidence,
      end: opts.end,
      transfer: opts.transfer,
    };
  }
}
