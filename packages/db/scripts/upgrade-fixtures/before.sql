-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: object storage (R4, migration 0013). The live release is
-- listing management (#82, migrations to 0012), which stores files in MinIO
-- and records only their URLs. This milestone adds stored_objects and copies
-- the files out of MinIO with storage-import (run by `pnpm stack upgrade`
-- after `after.sql`). So the fixture holds the URL shapes an import meets: a
-- QR code, a quality report's copy of a photo, more photos than the new limit
-- of 8, the same file twice, and a URL that is not ours. Earlier fixtures are
-- in this file's history.

CREATE TEMP TABLE fixture_source AS
  SELECT p.id, p.condition_photos->>0 AS photo
  FROM material_passports p
  WHERE p.custom_attributes->>'seedSource' IS NOT NULL
  ORDER BY p.product_name
  LIMIT 2;

-- The first seeded lot: its photo as its QR code too, and nine photos (one
-- more than the new limit), all the same file.
UPDATE material_passports p
  SET qr_code_url = s.photo,
      condition_photos = (SELECT jsonb_agg(s.photo) FROM generate_series(1, 9))
  FROM (SELECT * FROM fixture_source ORDER BY id LIMIT 1) s
  WHERE p.id = s.id;

-- The second: a photo hosted elsewhere, which the import must leave alone.
UPDATE material_passports p
  SET condition_photos = p.condition_photos || '["https://images.example.org/upgrade-fixture.jpg"]'::jsonb
  FROM (SELECT * FROM fixture_source ORDER BY id OFFSET 1 LIMIT 1) s
  WHERE p.id = s.id;

-- A quality report that copied its passport's photo, as reports do.
INSERT INTO quality_reports (passport_id, inspector_id, overall_grade, report_notes, photo_urls)
  SELECT s.id, (SELECT id FROM users ORDER BY created_at LIMIT 1), 'B',
         'upgrade fixture: report with a photo', jsonb_build_array(s.photo)
  FROM (SELECT * FROM fixture_source ORDER BY id OFFSET 1 LIMIT 1) s;

SELECT 'passports with photos: ' || count(*) FILTER (WHERE jsonb_array_length(condition_photos) > 0)
       || '; most photos on one: ' || max(jsonb_array_length(condition_photos))
       || '; QR codes: ' || count(qr_code_url)
       || '; photo URLs under /minio/: '
       || (SELECT count(*) FROM material_passports, jsonb_array_elements_text(condition_photos) u
           WHERE u LIKE '%/minio/%')
  FROM material_passports;
