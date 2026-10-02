-- Two things the release rehearsal against live-shaped data showed
-- (2026-10-02).
--
-- 1. The previous release must keep working on this schema: it serves traffic
--    while a deploy migrates, and it is the rollback target afterwards. It
--    inserts listings without quantity_available, which is NOT NULL and cannot
--    default to another column, so a trigger fills it from the lot size.
CREATE OR REPLACE FUNCTION listings_default_quantity_available() RETURNS trigger AS $$
BEGIN
  IF NEW.quantity_available IS NULL THEN
    NEW.quantity_available := NEW.quantity;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS listings_default_quantity_available ON "listings";--> statement-breakpoint
CREATE TRIGGER listings_default_quantity_available
  BEFORE INSERT ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listings_default_quantity_available();--> statement-breakpoint
-- 2. The old model could leave a lot "reserved" with no order at all (its
--    order was removed). Nothing holds it and nothing will ever release it.
--    Cancel the listing and free the material to be listed again, which is
--    what cancelling it by hand does. It is not put back on sale: that would
--    silently republish a lot its seller may have replaced since.
UPDATE "material_passports" p SET "status" = 'active', "updated_at" = now()
  FROM "listings" l
  WHERE l."passport_id" = p."id" AND l."status" = 'reserved' AND p."status" = 'reserved'
    AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."listing_id" = l."id");--> statement-breakpoint
UPDATE "listings" l SET "status" = 'cancelled', "quantity_available" = l."quantity"
  WHERE l."status" = 'reserved'
    AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."listing_id" = l."id");
