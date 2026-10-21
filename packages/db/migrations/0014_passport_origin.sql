-- Where a material comes from: reclaimed from a building, unused surplus, or
-- a new circular product (owner decision, 2026-10-13). Declared by the seller
-- and not part of the passport's fingerprint, like the circularity score.
-- Expand only: the previous release, which serves during a deploy and is the
-- rollback target, never reads it, and the rows it inserts leave it null. No
-- backfill: the curated catalogue gets its origin from demo:correct-catalogue
-- after the deploy, and a visitor's passport has none until its seller says.
ALTER TABLE "material_passports" ADD COLUMN IF NOT EXISTS "origin" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "material_passports" ADD CONSTRAINT "material_passports_origin_known"
    CHECK ("origin" IS NULL OR "origin" IN ('reclaimed', 'surplus', 'new'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
