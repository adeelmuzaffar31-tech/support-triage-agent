import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinalActionT } from "../src/actions.ts";
import { applyPolicy } from "../src/policy.ts";

const base: FinalActionT = {
  type: "final",
  category: "order_status",
  orderId: "SM-1001",
  reply: "Your order is in transit.",
  proposedAction: "none",
  confidence: 0.9,
  reason: "found",
};
const verified = { verifiedOrderIds: new Set(["SM-1001"]) };

test("a verified, confident, no-action reply goes out automatically", () => {
  assert.deepEqual(applyPolicy(base, verified), { requiresApproval: false, reasons: [] });
});

for (const proposedAction of ["refund", "reprint", "escalate"] as const) {
  test(`proposedAction=${proposedAction} requires approval`, () => {
    assert.equal(applyPolicy({ ...base, proposedAction }, verified).requiresApproval, true);
  });
}

test("low confidence requires approval", () => {
  assert.equal(applyPolicy({ ...base, confidence: 0.4 }, verified).requiresApproval, true);
});

test("a reply that promises money back without a refund action is held", () => {
  const d = applyPolicy({ ...base, reply: "No worries, we've refunded you already!" }, verified);
  assert.equal(d.requiresApproval, true);
});

test("an order id the agent never verified is held", () => {
  const d = applyPolicy({ ...base, orderId: "SM-9999" }, verified);
  assert.equal(d.requiresApproval, true);
});
