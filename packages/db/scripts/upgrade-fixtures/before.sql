-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: one of each (M2). The live release is M1 (#95, migrations to
-- 0014). M2 adds no migration; it deletes the spare passports a curated
-- product has beyond its one lot (demo:retire-spares) and makes the top-up
-- restock that lot in place. So the fixture holds what the live demo has, two
-- spare passports per product whose listings were cancelled, and the cases
-- that must survive:
--   Lintels: its lot partly sold (to restock), and a spare with an order on
--            it (kept and reported, never deleted);
--   Aerated Concrete Blocks: its lot sold out, so this checkout reopens it
--            in place (the previous release would have made a new passport);
--   Facing Bricks: its lot delisted, so this checkout lists it again;
-- plus a visitor's passport the tools must not touch. Earlier fixtures are in
-- this file's history.

-- Two spares per curated product, as the launch left them: copies of the
-- product's passport, numbered lots 2 and 3, each with a cancelled listing.
CREATE TEMP TABLE fixture_spare AS
  SELECT p.*, n AS lot, gen_random_uuid() AS new_id
  FROM material_passports p CROSS JOIN generate_series(2, 3) AS n
  WHERE p.custom_attributes->>'seedSource' IS NOT NULL;
UPDATE fixture_spare SET
  product_name = regexp_replace(product_name, ' — Demo Lot \d+$', '') || ' — Demo Lot 00' || lot,
  serial_number = 'TRACE-DEMO-FIXTURE-' || lot || '-' || left(id::text, 8),
  custom_attributes = custom_attributes || jsonb_build_object('demoLotNumber', lot),
  status = 'active', blockchain_passport_hash = NULL, blockchain_tx_hash = NULL,
  blockchain_anchored_at = NULL, qr_code_url = NULL, digital_link_uri = NULL;
ALTER TABLE fixture_spare DROP COLUMN lot;
UPDATE fixture_spare SET id = new_id;
ALTER TABLE fixture_spare DROP COLUMN new_id;
INSERT INTO material_passports SELECT * FROM fixture_spare;
INSERT INTO listings (passport_id, organisation_id, seller_id, price_pence, currency, quantity,
                      quantity_available, min_order_quantity, status, shipping_options)
  SELECT s.id, l.organisation_id, l.seller_id, l.price_pence, l.currency, l.quantity,
         l.quantity, l.min_order_quantity, 'cancelled', l.shipping_options
  FROM fixture_spare s
  JOIN listings l ON l.passport_id = (
    SELECT p.id FROM material_passports p
    WHERE p.custom_attributes->>'catalogueKey' = s.custom_attributes->>'catalogueKey'
      AND p.custom_attributes->>'demoLotNumber' IS DISTINCT FROM '2'
      AND p.custom_attributes->>'demoLotNumber' IS DISTINCT FROM '3'
    ORDER BY p.created_at LIMIT 1);

-- Lintels: one unit of its lot sold, with the selling event; and a spare
-- (lot 2) that sold a unit before it was cancelled.
CREATE TEMP TABLE fixture_order AS
  SELECT l.id AS listing_id, l.passport_id, l.seller_id, l.price_pence,
         (SELECT id FROM users WHERE role = 'buyer' ORDER BY created_at LIMIT 1) AS buyer_id,
         gen_random_uuid() AS order_id, l.status AS listing_status
  FROM listings l JOIN material_passports p ON p.id = l.passport_id
  WHERE p.custom_attributes->>'catalogueKey' = 'reclaimed-concrete-lintels'
    AND (l.status = 'active' OR p.custom_attributes->>'demoLotNumber' = '2');
INSERT INTO transactions (id, listing_id, buyer_id, seller_id, quantity, amount_pence, status,
                          response_deadline, dispute_deadline, notes, created_at)
  SELECT order_id, listing_id, buyer_id, seller_id, 1, price_pence, 'completed',
         now() - interval '5 days', now() - interval '1 day',
         'upgrade fixture: ' || listing_status || ' lot sale', now() - interval '6 days'
  FROM fixture_order;
UPDATE listings l SET quantity_available = l.quantity_available - 1
  FROM fixture_order o WHERE l.id = o.listing_id;
INSERT INTO passport_events (passport_id, event_type, event_data, actor_id)
  SELECT passport_id, 'TransactionEvent',
         jsonb_build_object('action', 'ADD',
                            'bizStep', 'urn:epcglobal:cbv:bizstep:selling',
                            'disposition', 'urn:epcglobal:cbv:disp:sold',
                            'transactionId', order_id, 'buyerId', buyer_id,
                            'quantity', 1, 'amountPence', price_pence),
         buyer_id
  FROM fixture_order;

-- Aerated Concrete Blocks: the whole lot sold, so it has no lot on sale.
CREATE TEMP TABLE fixture_sold AS
  SELECT l.id AS listing_id, l.passport_id, l.seller_id, l.price_pence, l.quantity,
         (SELECT id FROM users WHERE role = 'buyer' ORDER BY created_at LIMIT 1) AS buyer_id
  FROM listings l JOIN material_passports p ON p.id = l.passport_id
  WHERE p.custom_attributes->>'catalogueKey' = 'reclaimed-aerated-concrete-blocks'
    AND l.status = 'active';
INSERT INTO transactions (listing_id, buyer_id, seller_id, quantity, amount_pence, status,
                          response_deadline, dispute_deadline, notes, created_at)
  SELECT listing_id, buyer_id, seller_id, quantity, price_pence * quantity, 'completed',
         now() - interval '5 days', now() - interval '1 day',
         'upgrade fixture: whole lot sold', now() - interval '6 days'
  FROM fixture_sold;
UPDATE listings l SET quantity_available = 0, status = 'sold'
  FROM fixture_sold s WHERE l.id = s.listing_id;
UPDATE material_passports p SET status = 'sold'
  FROM fixture_sold s WHERE p.id = s.passport_id;

-- Facing Bricks: the seller cancelled its lot.
UPDATE listings l SET status = 'cancelled'
  FROM material_passports p
  WHERE l.passport_id = p.id AND p.custom_attributes->>'catalogueKey' = 'reclaimed-facing-bricks'
    AND l.status = 'active';
UPDATE material_passports p SET status = 'active'
  FROM listings l
  WHERE l.passport_id = p.id AND p.custom_attributes->>'catalogueKey' = 'reclaimed-facing-bricks';

-- A passport a visitor registered: no catalogue tag, so nothing may touch it.
INSERT INTO material_passports (product_name, category_l1, status, organisation_id, registered_by,
                                deconstruction_method, reclaimed_by, condition_grade)
  SELECT 'Upgrade Fixture Visitor Beam', 'structural-timber', 'active', p.organisation_id,
         p.registered_by, 'selective', 'A visitor', 'B'
  FROM material_passports p WHERE p.custom_attributes->>'seedSource' IS NOT NULL
  ORDER BY p.created_at LIMIT 1;

SELECT 'curated passports: '
       || (SELECT count(*) FROM material_passports WHERE custom_attributes->>'seedSource' IS NOT NULL)
       || ' for ' || (SELECT count(DISTINCT custom_attributes->>'catalogueKey') FROM material_passports
                      WHERE custom_attributes->>'seedSource' IS NOT NULL)
       || ' products; completed sales: ' || (SELECT count(*) FROM transactions WHERE status = 'completed')
       || '; visitor passports: '
       || (SELECT count(*) FROM material_passports WHERE custom_attributes->>'seedSource' IS NULL);
