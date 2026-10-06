import { z } from "zod";
import type { Repository } from "./repo.ts";

/**
 * A tool contract: the model can only act through these, and both the input it
 * proposes and the output we hand back are validated. A malformed tool call is
 * rejected before it touches the database; it never silently "half works".
 */
export interface ToolContract<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  input: I;
  output: O;
  run(repo: Repository, input: z.infer<I>): Promise<z.infer<O>>;
}

const OrderId = z
  .string()
  .regex(/^SM-\d{4}$/, "order ids look like SM-1234");

const GetOrderOutput = z.union([
  z.object({
    found: z.literal(true),
    id: z.string(),
    product: z.string(),
    quantity: z.number().int(),
    totalUsd: z.number(),
    status: z.string(),
    artworkIssue: z.string().nullable(),
  }),
  z.object({ found: z.literal(false), id: z.string() }),
]);

const GetShipmentOutput = z.union([
  z.object({
    found: z.literal(true),
    orderId: z.string(),
    carrier: z.string(),
    trackingCode: z.string(),
    status: z.string(),
    eta: z.string().nullable(),
    lastEvent: z.string().nullable(),
  }),
  z.object({ found: z.literal(false), orderId: z.string() }),
]);

export const getOrder: ToolContract<z.ZodObject<{ orderId: typeof OrderId }>, typeof GetOrderOutput> = {
  name: "get_order",
  description:
    "Look up an order by id. Returns product, quantity, total, status and any artwork problem flagged by prepress.",
  input: z.object({ orderId: OrderId }).strict(),
  output: GetOrderOutput,
  async run(repo, { orderId }) {
    const o = await repo.getOrder(orderId);
    if (!o) return { found: false as const, id: orderId };
    return {
      found: true as const,
      id: o.id,
      product: o.product,
      quantity: o.quantity,
      totalUsd: o.totalCents / 100,
      status: o.status,
      artworkIssue: o.artworkIssue,
    };
  },
};

export const getShipment: ToolContract<z.ZodObject<{ orderId: typeof OrderId }>, typeof GetShipmentOutput> = {
  name: "get_shipment",
  description:
    "Look up the shipment for an order: carrier, tracking code, shipment status, ETA and the latest carrier event.",
  input: z.object({ orderId: OrderId }).strict(),
  output: GetShipmentOutput,
  async run(repo, { orderId }) {
    const s = await repo.getShipment(orderId);
    if (!s) return { found: false as const, orderId };
    return { found: true as const, ...s };
  },
};

export const TOOLS: Record<string, ToolContract> = {
  [getOrder.name]: getOrder,
  [getShipment.name]: getShipment,
};

export type ToolResult =
  | { ok: true; tool: string; output: unknown }
  | { ok: false; tool: string; error: string };

/** Validate the model's proposed call against the contract, run it, validate the result. */
export async function callTool(repo: Repository, name: string, rawInput: unknown): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return { ok: false, tool: name, error: `Unknown tool "${name}". Available: ${Object.keys(TOOLS).join(", ")}` };
  }
  const input = tool.input.safeParse(rawInput);
  if (!input.success) {
    return { ok: false, tool: name, error: `Invalid input: ${input.error.issues.map((i) => i.message).join("; ")}` };
  }
  const output = tool.output.parse(await tool.run(repo, input.data));
  return { ok: true, tool: name, output };
}

export function describeTools(): string {
  return Object.values(TOOLS)
    .map((t) => `- ${t.name}: ${t.description} Input: {"orderId": "SM-1234"}`)
    .join("\n");
}
