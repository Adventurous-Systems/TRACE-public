-- Object storage moves from MinIO to plain files (R4, owner decisions
-- 2026-10-06 and 2026-10-07). This records every stored file and its size, so
-- an organisation's usage can be held to a quota. Expand only: the previous
-- release, which serves during a deploy and is the rollback target, neither
-- reads nor writes it. Files that release stored are recorded by the
-- storage-import operation after the deploy.
CREATE TABLE IF NOT EXISTS "stored_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"organisation_id" uuid REFERENCES "organisations"("id") ON DELETE SET NULL,
	"passport_id" uuid REFERENCES "material_passports"("id") ON DELETE SET NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stored_objects_bucket_key" UNIQUE ("bucket", "key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stored_objects_org" ON "stored_objects" ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stored_objects_passport" ON "stored_objects" ("passport_id");
