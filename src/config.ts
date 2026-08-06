import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DEEPGRAM_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  ELEVENLABS_MODEL_ID: z.string().default("eleven_flash_v2_5"),
  DEMO_FIRST_NAME: z.string().default("Jordan"),
  DEMO_LAST_NAME: z.string().default("Lee"),
  DEMO_REP_NAME: z.string().default("Alex"),
  DEMO_STATE: z.string().default("Texas"),
});

export const env = envSchema.parse(process.env);

export type LeadVars = {
  firstName: string;
  lastName: string;
  rep: string;
  state: string;
};

export function demoLead(): LeadVars {
  return {
    firstName: env.DEMO_FIRST_NAME,
    lastName: env.DEMO_LAST_NAME,
    rep: env.DEMO_REP_NAME,
    state: env.DEMO_STATE,
  };
}
