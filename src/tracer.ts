import { randomUUID } from "node:crypto";

export interface TraceEvent {
  traceId: string;
  step: number;
  event: string;
  ms: number;
  data?: Record<string, unknown>;
}

/**
 * Structured tracing for one triage run. Every step the agent takes is
 * recorded with the same traceId, so a single bad reply can be followed from
 * the model's raw output through each tool call to the policy decision.
 */
export class Tracer {
  readonly traceId: string;
  readonly events: TraceEvent[] = [];
  private readonly started = Date.now();

  constructor(
    traceId: string = randomUUID(),
    private readonly sink: ((e: TraceEvent) => void) | null = defaultSink,
  ) {
    this.traceId = traceId;
  }

  log(step: number, event: string, data?: Record<string, unknown>): void {
    const e: TraceEvent = { traceId: this.traceId, step, event, ms: Date.now() - this.started, data };
    this.events.push(e);
    this.sink?.(e);
  }
}

function defaultSink(e: TraceEvent): void {
  if (process.env.TRACE === "1") {
    process.stderr.write(JSON.stringify(e) + "\n");
  }
}
