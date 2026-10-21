-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.
--
-- Passport truth: the data must come through as the live release left it.
-- A sale's selling event keeps its buyer and amount in the database (the
-- public routes stop showing them; the data itself is not rewritten), the
-- draft stays a draft, and the visitor's passport is untouched. The rehearsal
-- then runs the catalogue corrections, and the previous release (the rollback
-- target) tops up the catalogue on the new schema.
--
-- Migration 0014 adds the passport's origin: nullable text, limited to the
-- three known values, and null on every row the live release left (no
-- backfill; the catalogue correction sets the curated ones afterwards).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'material_passports' AND column_name = 'origin'
                   AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'material_passports.origin is missing, or not nullable text';
  END IF;
  IF EXISTS (SELECT 1 FROM material_passports WHERE origin IS NOT NULL) THEN
    RAISE EXCEPTION 'the migration must not set an origin on existing passports';
  END IF;
  BEGIN
    UPDATE material_passports SET origin = 'bogus'
      WHERE id = (SELECT id FROM material_passports LIMIT 1);
    RAISE EXCEPTION 'an unknown origin was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM transactions
                 WHERE notes = 'upgrade fixture: completed sale' AND status = 'completed') THEN
    RAISE EXCEPTION 'the completed sale changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM passport_events
                 WHERE event_type = 'TransactionEvent' AND event_data ? 'buyerId'
                   AND event_data ? 'amountPence') THEN
    RAISE EXCEPTION 'the selling event lost its buyer or amount; the data must not be rewritten';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material_passports WHERE status = 'draft') THEN
    RAISE EXCEPTION 'the draft passport changed status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material_passports
                 WHERE product_name = 'Upgrade Fixture Visitor Beam'
                   AND deconstruction_method = 'selective' AND reclaimed_by = 'A visitor') THEN
    RAISE EXCEPTION 'the visitor''s passport changed';
  END IF;
END $$;

SELECT 'origin added, empty and checked; sale, selling event, draft and visitor passport unchanged';
