-- Buying part of a lot (owner decision, 2026-09-30). A listing's quantity is
-- the lot size; quantity_available is what is left after open and completed
-- orders; an order records how much of the lot it takes.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "quantity_available" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "min_order_quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Before this migration an order held the whole lot, whatever its amount, so
-- existing orders take the whole lot and a reserved or sold lot has nothing
-- left. Runs only while quantity_available is still unset, so it is safe to
-- re-apply.
UPDATE "transactions" t SET "quantity" = l."quantity"
  FROM "listings" l
  WHERE t."listing_id" = l."id" AND l."quantity_available" IS NULL;--> statement-breakpoint
UPDATE "listings" SET "quantity_available" =
  CASE WHEN "status" IN ('reserved', 'sold') THEN 0 ELSE "quantity" END
  WHERE "quantity_available" IS NULL;--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "quantity_available" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "listings" ADD CONSTRAINT "listings_quantity_available_range"
    CHECK ("quantity_available" >= 0 AND "quantity_available" <= "quantity");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "listings" ADD CONSTRAINT "listings_min_order_quantity_positive"
    CHECK ("min_order_quantity" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quantity_positive"
    CHECK ("quantity" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
