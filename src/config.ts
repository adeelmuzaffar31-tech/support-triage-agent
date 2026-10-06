import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().default("postgres://triage:triage@localhost:55432/triage"),
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(20).default(6),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
