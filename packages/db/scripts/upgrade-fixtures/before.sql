-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: new migration 0012 (order lifecycle: order_events,
-- transactions.response_deadline, users.orders_seen_at). The live release has
-- orders with quantities (0008-0010); whether it also has 0011 makes no
-- difference here. Earlier fixtures are in this file's history.

-- Open orders in every state, as the live release leaves them: no deadline to
-- answer by, no record of steps, and a problem flagged without a reason. Each
-- is days old, so every time limit of the new release has already passed.
CREATE TEMP TABLE fixture_plan (product text, quantity int, order_status text, deadline interval);
INSERT INTO fixture_plan VALUES
  ('K-BRIQ%',                            250, 'pending',   NULL),
  ('Sisalwool 100%',                     3,   'confirmed', '-3 days'),
  ('Reclaimed Aerated Concrete Blocks%', 5,   'confirmed', '1 day'),
  ('Reclaimed Concrete Lintels%',        2,   'disputed',  '-3 days'),
  ('Reclaimed Facing Bricks%',           10,  'completed', '-3 days');

CREATE TEMP TABLE fixture_lots AS
  SELECT l.id AS listing_id, l.seller_id, l.price_pence, plan.*
  FROM fixture_plan plan
  JOIN material_passports p ON p.product_name LIKE plan.product
    AND p.custom_attributes->>'seedSource' IS NOT NULL
  JOIN listings l ON l.passport_id = p.id AND l.status = 'active';

INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, quantity, status,
                          dispute_deadline, notes, created_at)
  SELECT lot.listing_id, buyer.id, lot.seller_id, lot.price_pence * lot.quantity, lot.quantity,
         lot.order_status, now() + lot.deadline, 'upgrade fixture: ' || lot.order_status,
         now() - interval '5 days'
  FROM fixture_lots lot, users buyer
  WHERE buyer.email = 'buyer@example.com';
UPDATE listings l SET quantity_available = l.quantity_available - lot.quantity
  FROM fixture_lots lot WHERE l.id = lot.listing_id;

SELECT (SELECT count(*) FROM transactions WHERE notes LIKE 'upgrade fixture:%') || ' order(s): '
       || (SELECT string_agg(status, ', ' ORDER BY status) FROM transactions
           WHERE notes LIKE 'upgrade fixture:%');
