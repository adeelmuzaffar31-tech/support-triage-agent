import { z } from "zod";

export const CATEGORIES = ["order_status", "shipping_problem", "artwork_issue", "refund_request", "other"] as const;
export const PROPOSED_ACTIONS = ["none", "refund", "reprint", "escalate"] as const;

export const ToolCallAction = z.object({
  type: z.literal("tool_call"),
  tool: z.string(),
  input: z.record(z.unknown()),
});

export const FinalAction = z.object({
  type: z.literal("final"),
  category: z.enum(CATEGORIES),
  orderId: z.string().nullable(),
  reply: z.string().min(1).max(1200),
  proposedAction: z.enum(PROPOSED_ACTIONS),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(400),
});

/** Every model turn must be exactly one of these. Anything else is rejected and fed back. */
export const AgentAction = z.discriminatedUnion("type", [ToolCallAction, FinalAction]);

export type AgentActionT = z.infer<typeof AgentAction>;
export type FinalActionT = z.infer<typeof FinalAction>;
export type Category = (typeof CATEGORIES)[number];

/** Pull the first JSON object out of a model response (models sometimes wrap it in prose or code fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export function parseAction(text: string): { ok: true; action: AgentActionT } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const parsed = AgentAction.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, action: parsed.data };
}
