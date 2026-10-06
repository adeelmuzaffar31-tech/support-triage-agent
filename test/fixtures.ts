import type { ChatMessage, LLMClient } from "../src/llm.ts";
import { InMemoryRepository, type Order, type Shipment } from "../src/repo.ts";
import { RetryableError } from "../src/retry.ts";

export const ORDERS: Order[] = [
  { id: "SM-1001", customerEmail: "ana@example.com", product: "Die cut stickers 3x3", quantity: 100, totalCents: 6900, status: "shipped", artworkIssue: null },
  { id: "SM-1003", customerEmail: "chen@example.com", product: "Holographic stickers 2x2", quantity: 50, totalCents: 5900, status: "awaiting_artwork_approval", artworkIssue: "Image resolution is 72 DPI; 300 DPI recommended for print." },
  { id: "SM-1005", customerEmail: "eli@example.com", product: "Magnets 3x3", quantity: 200, totalCents: 21000, status: "shipped", artworkIssue: null },
];

export const SHIPMENTS: Shipment[] = [
  { orderId: "SM-1001", carrier: "UPS", trackingCode: "1Z999AA10123456784", status: "in_transit", eta: "2026-10-09", lastEvent: "Departed facility" },
  { orderId: "SM-1005", carrier: "UPS", trackingCode: "1Z999AA10198765432", status: "exception", eta: null, lastEvent: "Address could not be verified" },
];

export const repo = () => new InMemoryRepository(ORDERS, SHIPMENTS);

/** A fake model that replays a fixed script. A step can also throw, to exercise retries. */
export class ScriptedLLM implements LLMClient {
  readonly name = "scripted";
  readonly calls: ChatMessage[][] = [];
  private i = 0;
  constructor(private readonly script: (string | Error)[]) {}

  async complete(_system: string, messages: ChatMessage[]): Promise<string> {
    this.calls.push([...messages]);
    const next = this.script[this.i++];
    if (next === undefined) throw new Error("ScriptedLLM ran out of responses");
    if (next instanceof Error) throw next;
    return next;
  }
}

export const tool = (name: string, orderId: string) =>
  JSON.stringify({ type: "tool_call", tool: name, input: { orderId } });

export const final = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "final",
    category: "order_status",
    orderId: "SM-1001",
    reply: "Your stickers are in transit with UPS and should arrive by Oct 9.",
    proposedAction: "none",
    confidence: 0.92,
    reason: "Shipment found and in transit.",
    ...over,
  });

export const transient = () => new RetryableError("503 overloaded", 503);
export const noSleep = async () => {};
