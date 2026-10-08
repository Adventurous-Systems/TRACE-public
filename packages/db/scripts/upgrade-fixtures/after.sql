-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.
--
-- Object storage (0013) only adds stored_objects: every URL must come through
-- unchanged, and the ledger must start empty, since the files are recorded by
-- storage-import after the deploy, not by the migration. The rehearsal then
-- runs that import and checks every /minio/ URL has a ledger row; the previous
-- release (the rollback target) tops up the catalogue through MinIO, and the
-- import runs again, as it would after a rollback window.

DO $$
DECLARE
  most int;
BEGIN
  IF to_regclass('public.stored_objects') IS NULL THEN
    RAISE EXCEPTION 'stored_objects was not created';
  END IF;
  IF (SELECT count(*) FROM stored_objects) <> 0 THEN
    RAISE EXCEPTION 'stored_objects must start empty; the import records the files';
  END IF;

  SELECT max(jsonb_array_length(condition_photos)) INTO most FROM material_passports;
  IF most <> 9 THEN
    RAISE EXCEPTION 'a passport over the new photo limit must keep its photos (expected 9, found %)', most;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material_passports, jsonb_array_elements_text(condition_photos) u
                 WHERE u = 'https://images.example.org/upgrade-fixture.jpg') THEN
    RAISE EXCEPTION 'a photo hosted elsewhere changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM quality_reports
                 WHERE report_notes = 'upgrade fixture: report with a photo'
                   AND jsonb_array_length(photo_urls) = 1) THEN
    RAISE EXCEPTION 'the quality report lost its photo';
  END IF;
END $$;

SELECT 'URLs unchanged; stored_objects empty until the import';
