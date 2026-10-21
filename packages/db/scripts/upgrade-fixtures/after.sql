-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.
--
-- One of each (M2): there is no migration, so everything must come through
-- as the live release left it. The rehearsal then runs this checkout's
-- post-deploy tools (demo:retire-spares, then the top-up restocking in place)
-- and prints any product still holding more than one passport: Lintels (its
-- spare has an order) and Aerated Concrete Blocks (its sold lot, plus the lot
-- the previous release creates in the rollback window) are expected there.

DO $$
BEGIN
  IF (SELECT count(*) FROM material_passports
      WHERE custom_attributes->>'seedSource' IS NOT NULL) <> 21 THEN
    RAISE EXCEPTION 'expected 21 curated passports (7 lots and 14 spares) before the tools run';
  END IF;
  IF (SELECT count(*) FROM transactions WHERE notes LIKE 'upgrade fixture: %'
        AND status = 'completed') <> 3 THEN
    RAISE EXCEPTION 'the fixture''s three completed sales changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM listings l JOIN material_passports p ON p.id = l.passport_id
                 WHERE p.custom_attributes->>'catalogueKey' = 'reclaimed-aerated-concrete-blocks'
                   AND l.status = 'sold' AND p.status = 'sold') THEN
    RAISE EXCEPTION 'the sold-out lot changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material_passports
                 WHERE product_name = 'Upgrade Fixture Visitor Beam'
                   AND deconstruction_method = 'selective' AND reclaimed_by = 'A visitor') THEN
    RAISE EXCEPTION 'the visitor''s passport changed';
  END IF;
END $$;

SELECT 'no migration: 21 curated passports, the three sales, the sold-out lot and the visitor passport unchanged';
