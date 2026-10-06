import { triage } from "./agent.ts";
import { loadConfig } from "./config.ts";
import { createLLM } from "./llm.ts";
import { PgRepository } from "./repo.ts";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Usage: npm run triage -- "Where is my order SM-1001?"');
  process.exit(1);
}

const config = loadConfig();
const repo = PgRepository.fromUrl(config.DATABASE_URL);

try {
  const result = await triage(message, {
    llm: createLLM(config),
    repo,
    maxSteps: config.MAX_AGENT_STEPS,
    llmRetries: config.LLM_MAX_RETRIES,
  });
  const { trace, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.TRACE !== "1") console.log(`\n(${trace.length} trace events; run with TRACE=1 to stream them)`);
} finally {
  await repo.close();
}
