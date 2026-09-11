ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "blockchain_private_key_enc" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"actor_email" text,
	"organisation_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"status" text NOT NULL,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blockchain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"organisation_id" uuid,
	"actor_id" uuid,
	"origin_address" text,
	"gas_payer_address" text,
	"contract_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"gas_limit" integer,
	"gas_used" integer,
	"vtho_paid_wei" text,
	"block_number" integer,
	"block_id" text,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_actor" ON "audit_events" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_org" ON "audit_events" USING btree ("organisation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_action" ON "audit_events" USING btree ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_resource" ON "audit_events" USING btree ("resource_type","resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_created" ON "audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blockchain_transactions_tx_hash_unique" ON "blockchain_transactions" USING btree ("tx_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blockchain_transactions_org" ON "blockchain_transactions" USING btree ("organisation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blockchain_transactions_actor" ON "blockchain_transactions" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blockchain_transactions_resource" ON "blockchain_transactions" USING btree ("resource_type","resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blockchain_transactions_status" ON "blockchain_transactions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blockchain_transactions_created" ON "blockchain_transactions" USING btree ("created_at");
