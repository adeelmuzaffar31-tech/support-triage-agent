import pg from "pg";

export type OrderStatus = "awaiting_artwork_approval" | "printing" | "shipped" | "delivered" | "cancelled";
export type ShipmentStatus = "label_created" | "in_transit" | "out_for_delivery" | "delivered" | "exception";

export interface Order {
  id: string;
  customerEmail: string;
  product: string;
  quantity: number;
  totalCents: number;
  status: OrderStatus;
  artworkIssue: string | null;
}

export interface Shipment {
  orderId: string;
  carrier: string;
  trackingCode: string;
  status: ShipmentStatus;
  eta: string | null;
  lastEvent: string | null;
}

export interface ApprovalItem {
  traceId: string;
  orderId: string | null;
  action: string;
  reason: string;
  draftReply: string;
}

/** Data access the agent's tools depend on. Postgres in production, in-memory in tests. */
export interface Repository {
  getOrder(id: string): Promise<Order | null>;
  getShipment(orderId: string): Promise<Shipment | null>;
  enqueueApproval(item: ApprovalItem): Promise<number>;
  listPendingApprovals(): Promise<(ApprovalItem & { id: number })[]>;
}

export class PgRepository implements Repository {
  constructor(private readonly pool: pg.Pool) {}

  static fromUrl(url: string): PgRepository {
    return new PgRepository(new pg.Pool({ connectionString: url, max: 4 }));
  }

  async getOrder(id: string): Promise<Order | null> {
    const { rows } = await this.pool.query(
      `SELECT id, customer_email, product, quantity, total_cents, status, artwork_issue FROM orders WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      customerEmail: r.customer_email,
      product: r.product,
      quantity: r.quantity,
      totalCents: r.total_cents,
      status: r.status,
      artworkIssue: r.artwork_issue,
    };
  }

  async getShipment(orderId: string): Promise<Shipment | null> {
    const { rows } = await this.pool.query(
      `SELECT order_id, carrier, tracking_code, status, to_char(eta, 'YYYY-MM-DD') AS eta, last_event
         FROM shipments WHERE order_id = $1`,
      [orderId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      orderId: r.order_id,
      carrier: r.carrier,
      trackingCode: r.tracking_code,
      status: r.status,
      eta: r.eta,
      lastEvent: r.last_event,
    };
  }

  async enqueueApproval(item: ApprovalItem): Promise<number> {
    const { rows } = await this.pool.query(
      `INSERT INTO approval_queue (trace_id, order_id, action, reason, draft_reply)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [item.traceId, item.orderId, item.action, item.reason, item.draftReply],
    );
    return rows[0].id as number;
  }

  async listPendingApprovals() {
    const { rows } = await this.pool.query(
      `SELECT id, trace_id, order_id, action, reason, draft_reply
         FROM approval_queue WHERE status = 'pending' ORDER BY id`,
    );
    return rows.map((r) => ({
      id: r.id as number,
      traceId: r.trace_id,
      orderId: r.order_id,
      action: r.action,
      reason: r.reason,
      draftReply: r.draft_reply,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemoryRepository implements Repository {
  readonly approvals: (ApprovalItem & { id: number })[] = [];

  constructor(
    private readonly orders: Order[] = [],
    private readonly shipments: Shipment[] = [],
  ) {}

  async getOrder(id: string) {
    return this.orders.find((o) => o.id === id) ?? null;
  }

  async getShipment(orderId: string) {
    return this.shipments.find((s) => s.orderId === orderId) ?? null;
  }

  async enqueueApproval(item: ApprovalItem) {
    const id = this.approvals.length + 1;
    this.approvals.push({ ...item, id });
    return id;
  }

  async listPendingApprovals() {
    return [...this.approvals];
  }
}
