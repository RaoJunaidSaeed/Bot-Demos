/**
 * Natural phone script — short, spoken English, not brochure copy.
 * Flow: how_are_you → pitch → coverage gates → transfer.
 */

import type { LeadVars } from "../config.js";

export type GateStep =
  | "how_are_you"
  | "pitch"
  | "insurance_check_1"
  | "state_confirm"
  | "insurance_check_2"
  | "transfer_consent"
  | "transferring"
  | "disqualified"
  | "dnc"
  | "ended";

export const STEP_LABELS: Record<GateStep, string> = {
  how_are_you: "Rapport",
  pitch: "Pitch + subsidy Q",
  insurance_check_1: "Coverage gate 1",
  state_confirm: "State confirm",
  insurance_check_2: "Coverage gate 2",
  transfer_consent: "Transfer consent",
  transferring: "Warm transfer",
  disqualified: "Disqualified",
  dnc: "Do not call",
  ended: "Ended",
};

export function fill(template: string, vars: LeadVars): string {
  return template
    .replace(/#FirstName#/g, vars.firstName)
    .replace(/#LastName#/g, vars.lastName)
    .replace(/#Rep#/g, vars.rep)
    .replace(/#State#/g, vars.state);
}

export const SCRIPT = {
  howAreYou: "Hi #FirstName#, how are you doing today?",

  howAreYouQ: "How are you doing today?",

  /** Intro + question — name once here for the normal path. */
  pitch:
    "This is #Rep# with Americas Health. Heads up — the call's recorded. Quick one: there's a free health subsidy through the affordable care Act a lot of people miss. Have you gotten that yet?",

  pitchQ: "Have you gotten that free health subsidy yet?",

  insuranceCheck1:
    "Cool. It's mainly for people who don't have Medicare, Medicaid, or insurance through work. You don't have any of those, right?",

  // insuranceCheck1Q: "No Medicare, Medicaid, or work insurance — right?",
  insuranceCheck1Q: "Sorry, just to clarify, do you currently have Medicare, Medicaid, or insurance through work?",

  stateConfirm: "And you're still in #State#, yeah?",

  stateConfirmQ: "Still in #State#?",

  // insuranceCheck2:
  //   "Just double-checking — you don't have Medicare, Medicaid, or work insurance?",

  insuranceCheck2:
    "Just double-checking — do you currently have Medicare, Medicaid, or work insurance?",

  // insuranceCheck2Q: "Still no Medicare, Medicaid, or work insurance?",
  insuranceCheck2Q: "Just to make sure I understood, do you have Medicare, Medicaid, or work insurance?",

  transferConsent:
    "Alright, that's all I need. I'm gonna grab someone who can see what you might qualify for. That cool?",

  transferConsentQ: "Mind if I connect you real quick?",

  transferring: "Okay, one sec — connecting you now.",

  disqualified:
    "Gotcha — this one's only if you don't have Medicare, Medicaid, or work coverage. Appreciate your time.",

  stateMismatch:
    "Okay, thanks for telling me. We'll need your current state later. Take care.",

  goodbye: "Alright, thanks for your time. Bye.",

  /** No reply after bot finishes — check presence, then hang up. */
  areYouThere: "Hello? Are you still there?",

  silenceHangup: "Looks like I lost you — I'll hang up. Bye.",
} as const;

/** Short acks into the pitch — no double "glad / glad". */
export const RAPPORT = {
  greeting_back: "I'm good, thanks.", // Used when they ask how you are
  doing_well: "Great.",             // Used when they just say "I'm good"
  doing_ok: "Gotcha.",              // Used when they just say "I'm okay"
  doing_bad: "Ah, sorry to hear that — I'll be quick.",
  busy: "All good, I'll be quick.",
  who_first: "It's #Rep# with Americas Health.",
  why_first: "Just a quick check on a health subsidy.",
  fallback: "Thanks for picking up.",
} as const;

export const REBUTTALS = {
  not_interested:
    "Totally get it — we only call to see if folks without Medicare, Medicaid, or work insurance can get that free ACA subsidy.",

  dnc: "Okay — I'll put you on our do-not-call list. You won't hear from us again.",

  pricing:
    "Yeah I can't quote prices — that's between you and the licensed agent. Don't want to get it wrong.",

  has_aca:
    "Gotcha. Sometimes new help drops and people aren't getting it yet — worth a thirty-second check.",

  who_calling:
    "It's #Rep# with Americas Health — just a quick eligibility check.",

  why_calling:
    "Just checking if you qualify for that free ACA health subsidy.",

  what_is_this:
    "Sorry — I mean a free health insurance subsidy through the Affordable Care Act, people also call it Obamacare. It's for folks who don't already have Medicare, Medicaid, or work coverage.",

  how_got_number:
    "Your info came through as maybe eligible — I'm just confirming a couple yes-or-no things.",

  wrong_person:
    "Oh — if you're not #FirstName#, my bad. Real quick before I go: do you have Medicare, Medicaid, or work insurance?",

  has_medicare:
    "Okay, if you've got Medicare this one's not the right fit. Thanks anyway.",

  has_medicaid:
    "Okay, if you've got Medicaid this one's not the right fit. Thanks anyway.",

  has_work_insurance:
    "Okay, if you've got work insurance this one's not the right fit. Thanks anyway.",

  scam_or_legit:
    "Fair question — it's a recorded eligibility check for the ACA subsidy. Anything private goes to a licensed agent, not me.",

  privacy_pushback:
    "Yeah that's fair — I'm not asking for Social or bank stuff. Just yes or no so we know if you're even in the ballpark.",

  already_covered:
    "Yep, sorry — I just need a clear yes or no on this one.",

  // maybe:
    // "All good if you're unsure — ballpark yes or no is fine.",

  maybe: 
    "No worries if you're not entirely sure.",

  busy_gate: "No worries — super quick, just yes or no:",

  frustrated_calls:
    "I get it — I'll keep it short. One yes-or-no and I'll get out of your hair.",

  want_hangup:
    "No problem. If you wanna bail that's fine — or I can finish in like twenty seconds.",
} as const;

export function fullLine(step: GateStep, vars: LeadVars): string {
  switch (step) {
    case "how_are_you":
      return fill(SCRIPT.howAreYou, vars);
    case "pitch":
      return fill(SCRIPT.pitch, vars);
    case "insurance_check_1":
      return fill(SCRIPT.insuranceCheck1, vars);
    case "state_confirm":
      return fill(SCRIPT.stateConfirm, vars);
    case "insurance_check_2":
      return fill(SCRIPT.insuranceCheck2, vars);
    case "transfer_consent":
      return fill(SCRIPT.transferConsent, vars);
    case "transferring":
      return SCRIPT.transferring;
    case "disqualified":
      return SCRIPT.disqualified;
    case "dnc":
      return REBUTTALS.dnc;
    default:
      return SCRIPT.goodbye;
  }
}

export function shortQuestion(step: GateStep, vars: LeadVars): string {
  switch (step) {
    case "how_are_you":
      return SCRIPT.howAreYouQ;
    case "pitch":
      return SCRIPT.pitchQ;
    case "insurance_check_1":
      return SCRIPT.insuranceCheck1Q;
    case "state_confirm":
      return fill(SCRIPT.stateConfirmQ, vars);
    case "insurance_check_2":
      return SCRIPT.insuranceCheck2Q;
    case "transfer_consent":
      return SCRIPT.transferConsentQ;
    default:
      return fullLine(step, vars);
  }
}
