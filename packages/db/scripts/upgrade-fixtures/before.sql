-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: live release with migrations 0000-0010; new migration 0011
-- (quality_reports.inspector_role). The fixture for 0008-0010 (orders from
-- before quantities) is in this file's history.

-- Quality reports as the live release files them: no role recorded. One by
-- each role that may file one.
INSERT INTO quality_reports (passport_id, inspector_id, overall_grade, structural_score, report_notes)
  SELECT p.id, u.id, 'B', 7, 'upgrade fixture: filed by ' || u.role
  FROM material_passports p, users u
  WHERE p.product_name LIKE 'Reclaimed Facing Bricks%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL
    AND u.email IN ('inspector@trace.eco', 'admin@stirlingreuse.com', 'platform@trace.eco');

-- An open order for part of a lot, so the invariants are checked against
-- orders as well as against a freshly seeded catalogue.
CREATE TEMP TABLE fixture_lot AS
  SELECT l.id, l.seller_id, l.price_pence
  FROM listings l JOIN material_passports p ON p.id = l.passport_id
  WHERE p.product_name LIKE 'K-BRIQ%' AND p.custom_attributes->>'seedSource' IS NOT NULL
    AND l.status = 'active'
  LIMIT 1;
INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, quantity, status, notes)
  SELECT lot.id, buyer.id, lot.seller_id, lot.price_pence * 250, 250, 'pending',
         'upgrade fixture: part of a lot'
  FROM fixture_lot lot, users buyer
  WHERE buyer.email = 'buyer@example.com';
UPDATE listings l SET quantity_available = quantity_available - 250
  FROM fixture_lot lot WHERE l.id = lot.id;

SELECT (SELECT count(*) FROM quality_reports WHERE report_notes LIKE 'upgrade fixture:%')
       || ' report(s), '
       || (SELECT count(*) FROM transactions WHERE notes LIKE 'upgrade fixture:%')
       || ' order(s)';
