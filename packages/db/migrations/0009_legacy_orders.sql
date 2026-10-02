-- Old orders in the new order steps (rehearsal finding F3, 2026-10-02).
--
-- 0008 marks the orders that existed before part-of-a-lot ordering as
-- legacy_whole_lot. A database that ran the first version of 0008 had no such
-- orders and no column, so the column is added here if it is missing.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "legacy_whole_lot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- "confirmed" used to mean the BUYER had confirmed delivery; it now means the
-- seller accepted and delivery is still to come. For an old order the sale
-- was already final.
UPDATE "transactions" SET "status" = 'completed'
  WHERE "legacy_whole_lot" AND "status" = 'confirmed';--> statement-breakpoint
-- The old model left a lot "reserved" for ever once its order was confirmed
-- or resolved. With nothing left and no order still in progress, it is sold.
UPDATE "listings" l SET "status" = 'sold'
  WHERE l."status" = 'reserved' AND l."quantity_available" = 0
    AND EXISTS (
      SELECT 1 FROM "transactions" t
      WHERE t."listing_id" = l."id" AND t."legacy_whole_lot" AND t."status" IN ('completed', 'resolved'))
    AND NOT EXISTS (
      SELECT 1 FROM "transactions" t
      WHERE t."listing_id" = l."id" AND t."status" IN ('pending', 'confirmed', 'disputed'));--> statement-breakpoint
UPDATE "material_passports" p SET "status" = 'sold', "updated_at" = now()
  FROM "listings" l
  WHERE l."passport_id" = p."id" AND l."status" = 'sold' AND p."status" = 'reserved'
    AND EXISTS (
      SELECT 1 FROM "transactions" t WHERE t."listing_id" = l."id" AND t."legacy_whole_lot");
