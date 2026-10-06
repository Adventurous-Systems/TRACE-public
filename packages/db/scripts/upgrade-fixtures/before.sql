-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: listing management (no new migration). The live release is the
-- order lifecycle (0012): orders carry their deadlines and steps, and a lot
-- can be fully ordered or expired. This milestone lets a seller change exactly
-- those lots, so the fixture holds one of each. Earlier fixtures are in this
-- file's history.

-- Open orders in every state, placed an hour ago with the deadlines the live
-- release gives them, so no time limit has passed.
CREATE TEMP TABLE fixture_plan (
  product text, quantity int, order_status text, answer_by interval, problem_window interval
);
INSERT INTO fixture_plan VALUES
  ('K-BRIQ%',                            250, 'pending',   '71 hours', NULL),
  ('Sisalwool 100%',                     3,   'confirmed', NULL,       '40 hours'),
  ('Reclaimed Concrete Lintels%',        2,   'disputed',  NULL,       '-2 hours'),
  ('Reclaimed Facing Bricks%',           10,  'completed', NULL,       '-2 hours'),
  -- The whole lot: fully ordered, off the marketplace.
  ('Reclaimed Prefabricated Staircase%', 2,   'pending',   '71 hours', NULL);

CREATE TEMP TABLE fixture_lots AS
  SELECT l.id AS listing_id, l.passport_id, l.seller_id, l.price_pence, plan.*
  FROM fixture_plan plan
  JOIN material_passports p ON p.product_name LIKE plan.product
    AND p.custom_attributes->>'seedSource' IS NOT NULL
  JOIN listings l ON l.passport_id = p.id AND l.status = 'active';

INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, quantity, status,
                          response_deadline, dispute_deadline, notes, created_at)
  SELECT lot.listing_id, buyer.id, lot.seller_id, lot.price_pence * lot.quantity, lot.quantity,
         lot.order_status, now() + lot.answer_by, now() + lot.problem_window,
         'upgrade fixture: ' || lot.order_status || ' ' || split_part(lot.product, '%', 1),
         now() - interval '1 hour'
  FROM fixture_lots lot, users buyer
  WHERE buyer.email = 'buyer@example.com';
INSERT INTO order_events (transaction_id, action, from_status, to_status, actor_id, actor_side, created_at)
  SELECT t.id, 'placed', NULL, 'pending', t.buyer_id, 'buyer', t.created_at
  FROM transactions t WHERE t.notes LIKE 'upgrade fixture:%';
UPDATE listings l SET quantity_available = l.quantity_available - lot.quantity
  FROM fixture_lots lot WHERE l.id = lot.listing_id;
UPDATE listings l SET status = 'reserved'
  FROM fixture_lots lot WHERE l.id = lot.listing_id AND l.quantity_available = 0;
UPDATE material_passports p SET status = 'reserved'
  FROM listings l WHERE l.passport_id = p.id AND l.status = 'reserved';

-- An expired lot, as the live sweep leaves it: off the marketplace, and its
-- material free to list again.
UPDATE listings l SET status = 'expired', expires_at = now() - interval '2 days'
  FROM material_passports p
  WHERE l.passport_id = p.id AND p.product_name LIKE 'Reclaimed Aluminium Stud Walling%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL AND l.status = 'active';
UPDATE material_passports p SET status = 'active'
  FROM listings l WHERE l.passport_id = p.id AND l.status = 'expired';

SELECT (SELECT count(*) FROM transactions WHERE notes LIKE 'upgrade fixture:%') || ' order(s): '
       || (SELECT string_agg(status, ', ' ORDER BY status) FROM transactions
           WHERE notes LIKE 'upgrade fixture:%')
       || '; lots: ' || (SELECT string_agg(status, ', ' ORDER BY status) FROM listings
                         WHERE status IN ('reserved', 'expired'));
