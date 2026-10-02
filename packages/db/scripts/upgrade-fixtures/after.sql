-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.

DO $$
DECLARE
  fixtures int;
  wrong int;
BEGIN
  SELECT count(*) INTO fixtures FROM quality_reports
    WHERE report_notes LIKE 'upgrade fixture: filed by %';
  IF fixtures <> 3 THEN
    RAISE EXCEPTION 'expected 3 fixture reports, found %', fixtures;
  END IF;

  -- 0011: every earlier report now records the role its reporter has.
  SELECT count(*) INTO wrong
    FROM quality_reports q JOIN users u ON u.id = q.inspector_id
    WHERE q.report_notes LIKE 'upgrade fixture: filed by %'
      AND q.inspector_role IS DISTINCT FROM u.role::text;
  IF wrong > 0 THEN
    RAISE EXCEPTION '% earlier report(s) have no role recorded, or the wrong one', wrong;
  END IF;
END $$;

-- The previous release serves during a deploy and is the rollback target. It
-- does not know the new column, so it files a report without it.
INSERT INTO quality_reports (passport_id, inspector_id, overall_grade, report_notes)
  SELECT p.id, u.id, 'B', 'upgrade fixture: the previous release, after the upgrade'
  FROM material_passports p, users u
  WHERE p.product_name LIKE 'Reclaimed Facing Bricks%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL
    AND u.email = 'inspector@trace.eco';

SELECT 'report: ' || q.report_notes || ' → role ' || coalesce(q.inspector_role, '(none; readers use the reporter''s role)')
  FROM quality_reports q
  WHERE q.report_notes LIKE 'upgrade fixture:%'
  ORDER BY q.created_at, q.report_notes;
