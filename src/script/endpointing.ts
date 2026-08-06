/**
 * Per-step endpointing profiles.
 */

import type { GateStep } from "./lines.js";

export type EndpointProfile = {
  endpointingMs: number;
  utteranceEndMs: number;
  minConfidence: number;
  postFinalHoldMs: number;
  minChars: number;
  expect: "yes_no" | "ok_consent" | "open" | "rapport" | "none";
};

export const ENDPOINT_PROFILES: Record<GateStep, EndpointProfile> = {
  how_are_you: {
    endpointingMs: 300,
    utteranceEndMs: 1000,
    minConfidence: 0.45,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "rapport",
  },
  pitch: {
    endpointingMs: 280,
    utteranceEndMs: 1000,
    minConfidence: 0.5,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "yes_no",
  },
  insurance_check_1: {
    endpointingMs: 280,
    utteranceEndMs: 1000,
    minConfidence: 0.6,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "yes_no",
  },
  state_confirm: {
    endpointingMs: 280,
    utteranceEndMs: 1000,
    minConfidence: 0.55,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "yes_no",
  },
  insurance_check_2: {
    endpointingMs: 280,
    utteranceEndMs: 1000,
    minConfidence: 0.65,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "yes_no",
  },
  transfer_consent: {
    endpointingMs: 300,
    utteranceEndMs: 1000,
    minConfidence: 0.6,
    postFinalHoldMs: 0,
    minChars: 1,
    expect: "ok_consent",
  },
  transferring: {
    endpointingMs: 500,
    utteranceEndMs: 1200,
    minConfidence: 0.7,
    postFinalHoldMs: 0,
    minChars: 2,
    expect: "none",
  },
  disqualified: {
    endpointingMs: 500,
    utteranceEndMs: 1200,
    minConfidence: 0.6,
    postFinalHoldMs: 0,
    minChars: 2,
    expect: "none",
  },
  dnc: {
    endpointingMs: 500,
    utteranceEndMs: 1200,
    minConfidence: 0.6,
    postFinalHoldMs: 0,
    minChars: 2,
    expect: "none",
  },
  ended: {
    endpointingMs: 800,
    utteranceEndMs: 1500,
    minConfidence: 0.8,
    postFinalHoldMs: 0,
    minChars: 3,
    expect: "none",
  },
};

export const OBJECTION_ENDPOINT: EndpointProfile = {
  endpointingMs: 550,
  utteranceEndMs: 1400,
  minConfidence: 0.55,
  postFinalHoldMs: 120,
  minChars: 2,
  expect: "open",
};

export const BARGE_IN = {
  minSpeechMs: 280,
  minConfidence: 0.55,
  backchannelMaxWords: 2,
  cooldownMs: 400,
} as const;

export const BACKCHANNELS = new Set([
  "uh",
  "uhhuh",
  "uh-huh",
  "uh huh",
  "mm",
  "mmhmm",
  "mm-hmm",
  "mmm",
  "mhm",
  "yeah",
  "yea",
  "yep",
  "yup",
  "ok",
  "okay",
  "right",
  "sure",
  "hmm",
  "hm",
  "ah",
  "oh",
]);
