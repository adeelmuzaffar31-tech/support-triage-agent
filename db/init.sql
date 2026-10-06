-- Schema and seed data for a small print-shop support desk.

CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL,
  product       TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
  status        TEXT NOT NULL CHECK (status IN ('awaiting_artwork_approval','printing','shipped','delivered','cancelled')),
  artwork_issue TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipments (
  order_id      TEXT PRIMARY KEY REFERENCES orders(id),
  carrier       TEXT NOT NULL,
  tracking_code TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('label_created','in_transit','out_for_delivery','delivered','exception')),
  eta           DATE,
  last_event    TEXT
);

-- Actions the agent may NOT take on its own land here for a human to approve.
CREATE TABLE approval_queue (
  id           SERIAL PRIMARY KEY,
  trace_id     TEXT NOT NULL,
  order_id     TEXT,
  action       TEXT NOT NULL,
  reason       TEXT NOT NULL,
  draft_reply  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO orders (id, customer_email, product, quantity, total_cents, status, artwork_issue) VALUES
  ('SM-1001', 'ana@example.com',   'Die cut stickers 3x3',      100,  6900, 'shipped',                   NULL),
  ('SM-1002', 'ben@example.com',   'Custom labels 2x4',         500, 14500, 'printing',                  NULL),
  ('SM-1003', 'chen@example.com',  'Holographic stickers 2x2',   50,  5900, 'awaiting_artwork_approval', 'Image resolution is 72 DPI; 300 DPI recommended for print.'),
  ('SM-1004', 'dina@example.com',  'Vinyl banner 2x6 ft',          1,  8900, 'delivered',                 NULL),
  ('SM-1005', 'eli@example.com',   'Magnets 3x3',               200, 21000, 'shipped',                   NULL),
  ('SM-1006', 'fatima@example.com','Die cut stickers 4x4',       250, 18900, 'cancelled',                 NULL),
  ('SM-1007', 'gus@example.com',   'Clear stickers 2x2',        100,  7400, 'awaiting_artwork_approval', 'Thin white outline will not print on clear material.'),
  ('SM-1008', 'hana@example.com',  'Packaging tape',             10, 12900, 'delivered',                 NULL);

INSERT INTO shipments (order_id, carrier, tracking_code, status, eta, last_event) VALUES
  ('SM-1001', 'UPS',  '1Z999AA10123456784', 'in_transit',       CURRENT_DATE + 2, 'Departed facility, Louisville KY'),
  ('SM-1004', 'USPS', '9400111899223197428490', 'delivered',    CURRENT_DATE - 3, 'Delivered, front porch'),
  ('SM-1005', 'UPS',  '1Z999AA10198765432', 'exception',        NULL,             'Address could not be verified; held at facility'),
  ('SM-1008', 'FedEx','612999AA10023456',   'delivered',        CURRENT_DATE - 1, 'Delivered, signed by H. TANAKA');
