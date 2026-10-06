import assert from "node:assert/strict";
import { test } from "node:test";
import { triage } from "../src/agent.ts";
import { Tracer } from "../src/tracer.ts";
import { final, noSleep, repo, ScriptedLLM, tool, transient } from "./fixtures.ts";

const quiet = () => new Tracer(undefined, null);

test("order status: looks up the order and shipment, then auto-replies", async () => {
  const r = repo();
  const llm = new ScriptedLLM([tool("get_order", "SM-1001"), tool("get_shipment", "SM-1001"), final()]);
  const res = await triage("Where is SM-1001?", { llm, repo: r, tracer: quiet(), sleep: noSleep });

  assert.equal(res.status, "auto_reply");
  assert.deepEqual(res.toolCalls.map((t) => t.tool), ["get_order", "get_shipment"]);
  assert.equal(r.approvals.length, 0);
  // The tool result was fed back to the model as its next input.
  assert.match(llm.calls[1]!.at(-1)!.content, /"status":"shipped"/);
});

test("refund requests are never auto-sent, even when the model is confident", async () => {
  const r = repo();
  const llm = new ScriptedLLM([
    tool("get_order", "SM-1005"),
    final({ category: "refund_request", orderId: "SM-1005", proposedAction: "refund", confidence: 0.99,
            reply: "A teammate will review your refund request today." }),
  ]);
  const res = await triage("Refund SM-1005 please", { llm, repo: r, tracer: quiet(), sleep: noSleep });

  assert.equal(res.status, "pending_approval");
  assert.equal(r.approvals.length, 1);
  assert.equal(r.approvals[0]!.action, "refund");
});

test("invalid model output is rejected, fed back, and the agent recovers", async () => {
  const llm = new ScriptedLLM([
    "Sure! The order is on its way.",                       // not JSON
    JSON.stringify({ type: "final", category: "order_status" }), // JSON but missing fields
    tool("get_order", "SM-1001"),
    final(),
  ]);
  const res = await triage("Where is SM-1001?", { llm, repo: repo(), tracer: quiet(), sleep: noSleep });

  assert.equal(res.status, "auto_reply");
  assert.equal(res.trace.filter((e) => e.event === "invalid_action").length, 2);
  assert.match(llm.calls[1]!.at(-1)!.content, /rejected/);
});

test("a malformed tool input never reaches the repository", async () => {
  const llm = new ScriptedLLM([
    JSON.stringify({ type: "tool_call", tool: "get_order", input: { orderId: "1001; DROP TABLE orders" } }),
    tool("get_order", "SM-1001"),
    final(),
  ]);
  const res = await triage("order 1001", { llm, repo: repo(), tracer: quiet(), sleep: noSleep });

  assert.deepEqual(res.toolCalls, [{ tool: "get_order", ok: false }, { tool: "get_order", ok: true }]);
  assert.match(llm.calls[1]!.at(-1)!.content, /Invalid input/);
});

test("replying about an order that was never looked up goes to a human", async () => {
  const llm = new ScriptedLLM([final({ orderId: "SM-1001" })]); // skipped the tools
  const res = await triage("Where is SM-1001?", { llm, repo: repo(), tracer: quiet(), sleep: noSleep });

  assert.equal(res.status, "pending_approval");
  assert.ok(res.approvalReasons.some((x) => x.includes("never looked up")));
});

test("transient LLM errors are retried", async () => {
  const llm = new ScriptedLLM([transient(), transient(), tool("get_order", "SM-1001"), final()]);
  const res = await triage("Where is SM-1001?", { llm, repo: repo(), tracer: quiet(), sleep: noSleep, llmRetries: 3 });

  assert.equal(res.status, "auto_reply");
  assert.equal(res.trace.filter((e) => e.event === "llm_retry").length, 2);
});

test("a run that cannot finish is escalated, not dropped", async () => {
  const r = repo();
  const llm = new ScriptedLLM(Array(3).fill(tool("get_order", "SM-1001")));
  const res = await triage("loop forever", { llm, repo: r, tracer: quiet(), sleep: noSleep, maxSteps: 3 });

  assert.equal(res.status, "failed");
  assert.equal(r.approvals.length, 1);
  assert.equal(r.approvals[0]!.action, "escalate");
});
