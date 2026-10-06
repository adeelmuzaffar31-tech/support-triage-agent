import { readFileSync, writeFileSync } from "node:fs";
import { triage, type TriageResult } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { createLLM } from "../src/llm.ts";
import { PgRepository } from "../src/repo.ts";
import { Tracer } from "../src/tracer.ts";

interface Expect {
  category?: string;
  status?: "auto_reply" | "pending_approval";
  tools?: string[];
  replyIncludes?: string[];
  replyIncludesAny?: string[];
  replyExcludes?: string[];
}
interface Case { id: string; message: string; expect: Expect }

/** Each case is scored on independent checks, so a failure says exactly what went wrong. */
function score(c: Case, r: TriageResult): { check: string; pass: boolean; detail?: string }[] {
  const out: { check: string; pass: boolean; detail?: string }[] = [];
  const reply = (r.reply ?? "").toLowerCase();
  const e = c.expect;

  out.push({ check: "completed", pass: r.status !== "failed", detail: r.error });
  if (e.category) out.push({ check: "category", pass: r.category === e.category, detail: `got ${r.category}` });
  if (e.status) out.push({ check: "routing", pass: r.status === e.status, detail: `got ${r.status}` });
  if (e.tools) {
    const used = new Set(r.toolCalls.filter((t) => t.ok).map((t) => t.tool));
    const pass = e.tools.length === 0 ? used.size === 0 : e.tools.every((t) => used.has(t));
    out.push({ check: "tools", pass, detail: `used [${[...used].join(", ")}]` });
  }
  for (const s of e.replyIncludes ?? []) {
    out.push({ check: `reply has "${s}"`, pass: reply.includes(s.toLowerCase()) });
  }
  if (e.replyIncludesAny) {
    out.push({ check: "reply mentions key fact", pass: e.replyIncludesAny.some((s) => reply.includes(s.toLowerCase())) });
  }
  for (const s of e.replyExcludes ?? []) {
    out.push({ check: `reply avoids "${s}"`, pass: !reply.includes(s.toLowerCase()) });
  }
  return out;
}

const config = loadConfig();
const llm = createLLM(config);
const repo = PgRepository.fromUrl(config.DATABASE_URL);
const cases: Case[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));

const rows: { id: string; checks: ReturnType<typeof score>; result: TriageResult }[] = [];
try {
  for (const c of cases) {
    const result = await triage(c.message, {
      llm,
      repo,
      maxSteps: config.MAX_AGENT_STEPS,
      llmRetries: config.LLM_MAX_RETRIES,
      tracer: new Tracer(undefined, null),
    });
    const checks = score(c, result);
    rows.push({ id: c.id, checks, result });
    const failed = checks.filter((x) => !x.pass);
    console.log(`${failed.length ? "FAIL" : "pass"}  ${c.id}${failed.length ? "  -> " + failed.map((f) => `${f.check} (${f.detail ?? ""})`).join("; ") : ""}`);
  }
} finally {
  await repo.close();
}

// Aggregate by check type, so the README can say *where* the agent is weak.
const byCheck = new Map<string, { pass: number; total: number }>();
for (const row of rows) {
  for (const ch of row.checks) {
    const key = ch.check.startsWith("reply") ? "reply content" : ch.check;
    const agg = byCheck.get(key) ?? { pass: 0, total: 0 };
    agg.total++;
    if (ch.pass) agg.pass++;
    byCheck.set(key, agg);
  }
}
const fullyPassed = rows.filter((r) => r.checks.every((c) => c.pass)).length;
const avgSteps = rows.reduce((s, r) => s + r.result.steps, 0) / rows.length;

const md = [
  `# Evaluation results`,
  ``,
  `Model: \`${llm.name}\` · Cases: ${rows.length} · Run: ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `**Cases fully passing: ${fullyPassed}/${rows.length}** · Average agent steps: ${avgSteps.toFixed(1)}`,
  ``,
  `| Check | Passed |`,
  `|---|---|`,
  ...[...byCheck].map(([k, v]) => `| ${k} | ${v.pass}/${v.total} |`),
  ``,
  `| Case | Result | Status | Category | Tools used |`,
  `|---|---|---|---|---|`,
  ...rows.map((r) => {
    const ok = r.checks.every((c) => c.pass);
    const tools = r.result.toolCalls.map((t) => t.tool + (t.ok ? "" : "(x)")).join(", ") || "-";
    return `| ${r.id} | ${ok ? "pass" : "FAIL"} | ${r.result.status} | ${r.result.category ?? "-"} | ${tools} |`;
  }),
  ``,
].join("\n");

writeFileSync(new URL("./results.md", import.meta.url), md);
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(rows, null, 2));
console.log(`\n${fullyPassed}/${rows.length} cases fully passing. Wrote eval/results.md`);
