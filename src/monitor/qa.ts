/**
 * Mock-call QA monitor — flags nonsensical bot replies for review.
 */

import fs from "fs";
import path from "path";
import type { Intent } from "../llm/classifier.js";
import type { GateStep } from "../script/lines.js";

export type QaFlag =
  | "wrong_lead_in"
  | "ignored_question"
  | "rapport_ack_off_step"
  | "empty_answer"
  | "ok";

export type TurnMonitorEvent = {
  at: string;
  step: GateStep;
  user: string;
  intent: Intent;
  intentConfidence: number;
  bot: string;
  flags: QaFlag[];
  notes: string[];
  decideMs?: number;
};

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "mock-calls.jsonl");

/** Lead-ins that only make sense for specific intents. */
const LEAD_IN_RULES: { re: RegExp; allowedIf: (intent: Intent, step: GateStep) => boolean; flag: QaFlag; note: string }[] = [
  {
    re: /^glad to hear it\b/i,
    allowedIf: (intent, step) => step === "how_are_you" || intent === "doing_well" || intent === "doing_ok",
    flag: "rapport_ack_off_step",
    note: "Used 'Glad to hear it' outside a positive how-are-you answer",
  },
  {
    re: /^sure\b/i,
    allowedIf: (intent) =>
      intent === "ok" || intent === "yes" || intent === "repeat" || intent === "greeting_back",
    flag: "wrong_lead_in",
    note: "Started with 'Sure' in a weird spot",
  },
  {
    re: /^totally fair\b/i,
    allowedIf: () => false,
    flag: "wrong_lead_in",
    note: "Bookish 'Totally fair' lead-in",
  },
  {
    re: /^glad i caught you\b/i,
    allowedIf: () => false,
    flag: "wrong_lead_in",
    note: "Salesy 'Glad I caught you'",
  },
  {
    re: /^fair enough\b/i,
    allowedIf: (intent) => intent === "privacy_pushback" || intent === "not_interested",
    flag: "wrong_lead_in",
    note: "Started with 'Fair enough' for an unmatched intent",
  },
  {
    re: /^hey\b/i,
    allowedIf: (intent) => intent === "greeting_back",
    flag: "wrong_lead_in",
    note: "Started with 'Hey' when user wasn't greeting",
  },
  {
    re: /^let me say that again\b/i,
    allowedIf: () => false,
    flag: "wrong_lead_in",
    note: "Robotic 'Let me say that again'",
  },
];

function userAskedClarification(user: string): boolean {
  const t = user.toLowerCase();
  return /\b(what|which|why|who|how|explain|mean|saying|talking about)\b/.test(t);
}

function botExplains(bot: string): boolean {
  const t = bot.toLowerCase();
  return (
    /\b(affordable care|subsidy|americas health|medicare|medicaid|eligibility|licensed agent|recorded)\b/.test(t) &&
    !/^(sure|fair enough|hey|sorry)\b/.test(t.trim())
  );
}

export function evaluateTurn(ev: {
  step: GateStep;
  user: string;
  intent: Intent;
  intentConfidence: number;
  bot: string;
}): { flags: QaFlag[]; notes: string[] } {
  const flags: QaFlag[] = [];
  const notes: string[] = [];
  const bot = ev.bot.trim();

  if (!bot) {
    flags.push("empty_answer");
    notes.push("Empty bot reply");
    return { flags, notes };
  }

  for (const rule of LEAD_IN_RULES) {
    if (rule.re.test(bot) && !rule.allowedIf(ev.intent, ev.step)) {
      flags.push(rule.flag);
      notes.push(rule.note);
    }
  }

  // User asked what/which/why — bot must actually explain, not only re-ask
  if (userAskedClarification(ev.user)) {
    const onlyRestate =
      /have you received that free health government subsidy yet\??$/i.test(bot) ||
      /^(sure|fair enough|sorry|hey)[—. ]+/i.test(bot) &&
        /have you received/i.test(bot) &&
        !botExplains(bot);
    if (
      onlyRestate ||
      (["what_is_this", "why_calling", "who_calling", "privacy_pushback", "repeat"].includes(ev.intent) === false &&
        userAskedClarification(ev.user) &&
        !botExplains(bot))
    ) {
      // If intent is correctly what_is_this etc and bot explains, OK
      if (!botExplains(bot) || ev.intent === "ambiguous" || ev.intent === "other" || ev.intent === "repeat") {
        if (ev.intent === "repeat" && /let me (say|repeat)|of course|one more time/i.test(bot)) {
          // ok for repeat
        } else if (!botExplains(bot)) {
          flags.push("ignored_question");
          notes.push("User asked a clarifying question; bot mostly restated the gate question");
        }
      }
    }
  }

  // Rapport mood intents after leaving how_are_you
  if (
    ev.step !== "how_are_you" &&
    (ev.intent === "doing_well" || ev.intent === "doing_ok" || ev.intent === "doing_bad") &&
    /^glad to hear it\b/i.test(bot)
  ) {
    flags.push("rapport_ack_off_step");
    notes.push("Rapport acknowledgment used after pitch/gate started");
  }

  if (!flags.length) flags.push("ok");
  return { flags, notes };
}

export function appendMonitor(event: TurnMonitorEvent): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(event)}\n`, "utf8");
  } catch (e) {
    console.error("[monitor] write failed", e);
  }
  const bad = event.flags.filter((f) => f !== "ok");
  if (bad.length) {
    console.warn(`[qa] ${bad.join(",")} | user="${event.user}" | intent=${event.intent} | bot="${event.bot.slice(0, 80)}…"`);
  } else {
    console.log(`[qa] ok | intent=${event.intent} | step=${event.step}`);
  }
}
