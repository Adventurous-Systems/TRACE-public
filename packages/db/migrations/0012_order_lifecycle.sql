-- Order lifecycle (owner decisions, 2026-10-02): a flag carries a reason, a
-- flagged order is resolved with an outcome, and orders no longer stay open
-- for ever. Expand only: the previous release, which serves during a deploy
-- and is the rollback target, reads and writes none of this.

-- Every step of an order, with who took it and what they said. The order row
-- keeps its current state; this is how it got there.
CREATE TABLE IF NOT EXISTS "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid REFERENCES "users"("id"),
	"actor_side" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_events_transaction" ON "order_events" ("transaction_id", "created_at");--> statement-breakpoint

-- When an unanswered order lapses. Null on an order the previous release
-- placed; readers then count from when it was placed.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "response_deadline" timestamp with time zone;--> statement-breakpoint

-- When this person last opened their orders, for "changed since you looked".
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "orders_seen_at" timestamp with time zone;--> statement-breakpoint

-- Orders already open get a full period from now, so nothing lapses or
-- completes the moment this release starts: unanswered orders 72 hours, and
-- accepted orders whose problem window has already passed 48 hours.
UPDATE "transactions" SET "response_deadline" = now() + interval '72 hours'
  WHERE "status" = 'pending' AND "response_deadline" IS NULL;--> statement-breakpoint
UPDATE "transactions" SET "dispute_deadline" = now() + interval '48 hours'
  WHERE "status" = 'confirmed' AND ("dispute_deadline" IS NULL OR "dispute_deadline" < now() + interval '48 hours');
