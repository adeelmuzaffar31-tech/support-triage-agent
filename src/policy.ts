import type { FinalActionT } from "./actions.ts";

export const CONFIDENCE_THRESHOLD = 0.7;

export interface PolicyDecision {
  requiresApproval: boolean;
  reasons: string[];
}

export interface PolicyContext {
  /** Order ids the agent actually looked up with a tool during this run. */
  verifiedOrderIds: Set<string>;
}

const MONEY_PROMISE = /\b(refund(ed)?|credit(ed)?|reimburs\w*|money back)\b/i;

/**
 * Deterministic guardrails applied AFTER the model decides. The model can
 * suggest anything; this code decides what is allowed to go out without a
 * human. Kept as plain code on purpose: it is testable and cannot be talked
 * out of its rules by a cleverly worded customer message.
 */
export function applyPolicy(final: FinalActionT, ctx: PolicyContext): PolicyDecision {
  const reasons: string[] = [];

  if (final.proposedAction === "refund" || final.proposedAction === "reprint") {
    reasons.push(`Proposed action "${final.proposedAction}" costs money and always needs a human.`);
  }
  if (final.proposedAction === "escalate") {
    reasons.push("Model asked to escalate.");
  }
  if (final.confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(`Model confidence ${final.confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}.`);
  }
  if (final.category === "other") {
    reasons.push("Message did not fit a known category.");
  }
  if (final.orderId && !ctx.verifiedOrderIds.has(final.orderId)) {
    reasons.push(`Reply references order ${final.orderId}, which was never looked up with a tool.`);
  }
  if (MONEY_PROMISE.test(final.reply) && final.proposedAction !== "refund") {
    reasons.push("Draft reply mentions money back without a refund being proposed.");
  }

  return { requiresApproval: reasons.length > 0, reasons };
}
