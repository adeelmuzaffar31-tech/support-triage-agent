import { parseAction, type Category, type FinalActionT } from "./actions.ts";
import type { ChatMessage, LLMClient } from "./llm.ts";
import { applyPolicy } from "./policy.ts";
import { SYSTEM_PROMPT, userTurn } from "./prompt.ts";
import type { Repository } from "./repo.ts";
import { withRetry } from "./retry.ts";
import { callTool } from "./tools.ts";
import { Tracer, type TraceEvent } from "./tracer.ts";

export interface AgentDeps {
  llm: LLMClient;
  repo: Repository;
  maxSteps?: number;
  llmRetries?: number;
  tracer?: Tracer;
  /** Injectable for tests so retries don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TriageResult {
  traceId: string;
  status: "auto_reply" | "pending_approval" | "failed";
  category: Category | null;
  orderId: string | null;
  reply: string | null;
  proposedAction: FinalActionT["proposedAction"] | null;
  approvalReasons: string[];
  approvalId: number | null;
  toolCalls: { tool: string; ok: boolean }[];
  steps: number;
  trace: TraceEvent[];
  error?: string;
}

/**
 * The agent loop. Each turn the model returns one JSON action; we validate it,
 * run tool calls through their contracts, feed results back, and stop at a
 * final decision. Invalid output is never acted on: the validation error goes
 * back to the model as feedback and costs one step of the budget.
 */
export async function triage(customerMessage: string, deps: AgentDeps): Promise<TriageResult> {
  const { llm, repo, maxSteps = 6, llmRetries = 3, sleep } = deps;
  const tracer = deps.tracer ?? new Tracer();
  const messages: ChatMessage[] = [{ role: "user", content: userTurn(customerMessage) }];
  const toolCalls: { tool: string; ok: boolean }[] = [];
  const verifiedOrderIds = new Set<string>();

  tracer.log(0, "start", { model: llm.name, chars: customerMessage.length });

  for (let step = 1; step <= maxSteps; step++) {
    let text: string;
    try {
      text = await withRetry(() => llm.complete(SYSTEM_PROMPT, messages), {
        retries: llmRetries,
        sleep,
        onRetry: (err, attempt, delayMs) =>
          tracer.log(step, "llm_retry", { attempt, delayMs, error: (err as Error).message }),
      });
    } catch (err) {
      tracer.log(step, "llm_failed", { error: (err as Error).message });
      return failed(repo, tracer, step, toolCalls, `LLM call failed: ${(err as Error).message}`);
    }
    messages.push({ role: "assistant", content: text });

    const parsed = parseAction(text);
    if (!parsed.ok) {
      tracer.log(step, "invalid_action", { error: parsed.error });
      messages.push({
        role: "user",
        content: `Your last response was rejected: ${parsed.error}. Reply with exactly one valid JSON action.`,
      });
      continue;
    }

    const action = parsed.action;
    if (action.type === "tool_call") {
      const result = await callTool(repo, action.tool, action.input);
      toolCalls.push({ tool: action.tool, ok: result.ok });
      tracer.log(step, "tool_call", { tool: action.tool, input: action.input, ok: result.ok });
      if (result.ok) {
        const out = result.output as { found?: boolean; id?: string; orderId?: string };
        const id = out.id ?? out.orderId;
        if (out.found && id) verifiedOrderIds.add(id);
        messages.push({ role: "user", content: `Tool result for ${action.tool}:\n${JSON.stringify(result.output)}` });
      } else {
        messages.push({ role: "user", content: `Tool call failed: ${result.error}` });
      }
      continue;
    }

    // Final decision: the model proposes, deterministic policy disposes.
    const decision = applyPolicy(action, { verifiedOrderIds });
    tracer.log(step, "final", {
      category: action.category,
      proposedAction: action.proposedAction,
      confidence: action.confidence,
      requiresApproval: decision.requiresApproval,
      reasons: decision.reasons,
    });

    let approvalId: number | null = null;
    if (decision.requiresApproval) {
      approvalId = await repo.enqueueApproval({
        traceId: tracer.traceId,
        orderId: action.orderId,
        action: action.proposedAction,
        reason: decision.reasons.join(" "),
        draftReply: action.reply,
      });
      tracer.log(step, "queued_for_approval", { approvalId });
    }

    return {
      traceId: tracer.traceId,
      status: decision.requiresApproval ? "pending_approval" : "auto_reply",
      category: action.category,
      orderId: action.orderId,
      reply: action.reply,
      proposedAction: action.proposedAction,
      approvalReasons: decision.reasons,
      approvalId,
      toolCalls,
      steps: step,
      trace: tracer.events,
    };
  }

  tracer.log(maxSteps, "step_budget_exhausted");
  return failed(repo, tracer, maxSteps, toolCalls, `No final decision within ${maxSteps} steps`);
}

/** A run that cannot finish is never dropped: it goes to a human with the trace id attached. */
async function failed(
  repo: Repository,
  tracer: Tracer,
  steps: number,
  toolCalls: { tool: string; ok: boolean }[],
  error: string,
): Promise<TriageResult> {
  const approvalId = await repo.enqueueApproval({
    traceId: tracer.traceId,
    orderId: null,
    action: "escalate",
    reason: error,
    draftReply: "(no draft: the agent could not complete this message)",
  });
  tracer.log(steps, "queued_for_approval", { approvalId, failed: true });
  return {
    traceId: tracer.traceId,
    status: "failed",
    category: null,
    orderId: null,
    reply: null,
    proposedAction: null,
    approvalReasons: [error],
    approvalId,
    toolCalls,
    steps,
    trace: tracer.events,
    error,
  };
}
