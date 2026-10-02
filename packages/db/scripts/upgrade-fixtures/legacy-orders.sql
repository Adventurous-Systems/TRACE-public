-- Orders as the release before migration 0008 could leave them: one order per
-- curated lot, in every state, each holding the WHOLE lot for one unit's
-- price. Applied by `pnpm stack upgrade` to a scratch database built with the
-- previous release, so the new migrations meet old data before production
-- does. It uses only columns that release has.
--
-- State of the old model (verified against its updateTransaction):
--   pending    listing reserved, passport reserved
--   confirmed  the BUYER confirmed delivery; listing and passport stay reserved
--   disputed   listing and passport reserved
--   resolved   listing and passport reserved (nothing moved a resolved order on)
--   completed  listing sold, passport sold
--   cancelled  listing active, passport listed
-- Plus one lot left reserved with no order at all.
CREATE TEMP TABLE legacy_plan (product text, order_status text, listing_status text, passport_status text);
INSERT INTO legacy_plan VALUES
  ('K-BRIQ%',                            'pending',   'reserved', 'reserved'),
  ('Sisalwool 100%',                     'confirmed', 'reserved', 'reserved'),
  ('Reclaimed Aerated Concrete Blocks%', 'disputed',  'reserved', 'reserved'),
  ('Reclaimed Concrete Lintels%',        'resolved',  'reserved', 'reserved'),
  ('Reclaimed Facing Bricks%',           'completed', 'sold',     'sold'),
  ('Reclaimed Prefabricated Staircase%', 'cancelled', 'active',   'listed');

CREATE TEMP TABLE legacy_lots AS
  SELECT l.id AS listing_id, l.passport_id, l.seller_id, l.price_pence, plan.*
  FROM legacy_plan plan
  JOIN material_passports p ON p.product_name LIKE plan.product
    AND p.custom_attributes->>'seedSource' IS NOT NULL
  JOIN listings l ON l.passport_id = p.id AND l.status = 'active';

INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, status, dispute_deadline, notes)
  SELECT lot.listing_id, buyer.id, lot.seller_id, lot.price_pence, lot.order_status,
         now() + interval '48 hours', 'legacy fixture: ' || lot.order_status
  FROM legacy_lots lot, users buyer
  WHERE buyer.email = 'buyer@example.com';

UPDATE listings l SET status = lot.listing_status FROM legacy_lots lot WHERE l.id = lot.listing_id;
UPDATE material_passports p SET status = lot.passport_status FROM legacy_lots lot WHERE p.id = lot.passport_id;

-- A lot the old model left "reserved" with no order at all (seen on the live
-- demo, 2026-10-02): nothing holds it, and nothing would ever release it.
UPDATE listings l SET status = 'reserved'
  FROM material_passports p
  WHERE p.id = l.passport_id AND p.product_name LIKE 'Reclaimed Aluminium Stud Walling%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL AND l.status = 'active';
UPDATE material_passports SET status = 'reserved'
  WHERE product_name LIKE 'Reclaimed Aluminium Stud Walling%'
    AND custom_attributes->>'seedSource' IS NOT NULL;

SELECT count(*) AS legacy_orders FROM transactions WHERE notes LIKE 'legacy fixture:%';
