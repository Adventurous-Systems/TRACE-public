-- Whether a quality report is an independent inspection or the seller's own
-- check is a fact about the report, so the reporter's role is recorded on it
-- (owner decision, 2026-10-02). Nullable: the previous release, which serves
-- during a deploy and is the rollback target, does not set it; readers fall
-- back to the reporter's current role.
ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "inspector_role" text;--> statement-breakpoint
UPDATE "quality_reports" q SET "inspector_role" = u."role"
  FROM "users" u
  WHERE u."id" = q."inspector_id" AND q."inspector_role" IS NULL;
