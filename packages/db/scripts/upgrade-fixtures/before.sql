-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: passport truth (0014). The live release is R4 (#86/#90,
-- migrations to 0013), which stores files on disk and records each one. This
-- milestone adds a passport's origin (a new column the live release never
-- sets), corrects the catalogue after the deploy (demo:correct-catalogue, run
-- by `pnpm stack upgrade` after `after.sql`), and stops the public passport
-- routes from showing a sale's buyer and amount, or a draft. So the fixture
-- holds a completed sale with its history event, a passport a visitor
-- registered, the seeded draft, and a cancelled curated lot the previous
-- release tops up again. Earlier fixtures are in this file's history.

-- A completed sale of one lintel from a curated lot: the order, the lot one
-- smaller, and the selling event the release writes, with the buyer and the
-- amount in it.
CREATE TEMP TABLE fixture_sale AS
  SELECT l.id AS listing_id, l.passport_id, l.seller_id, l.price_pence,
         (SELECT id FROM users WHERE role = 'buyer' ORDER BY created_at LIMIT 1) AS buyer_id,
         gen_random_uuid() AS order_id
  FROM listings l JOIN material_passports p ON p.id = l.passport_id
  WHERE p.product_name LIKE 'Reclaimed Concrete Lintels%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL AND l.status = 'active'
  ORDER BY l.created_at LIMIT 1;

INSERT INTO transactions (id, listing_id, buyer_id, seller_id, quantity, amount_pence, status,
                          response_deadline, dispute_deadline, notes, created_at)
  SELECT order_id, listing_id, buyer_id, seller_id, 1, price_pence, 'completed',
         now() - interval '5 days', now() - interval '1 day', 'upgrade fixture: completed sale',
         now() - interval '6 days'
  FROM fixture_sale;
UPDATE listings l SET quantity_available = l.quantity_available - 1
  FROM fixture_sale s WHERE l.id = s.listing_id;
INSERT INTO passport_events (passport_id, event_type, event_data, actor_id)
  SELECT passport_id, 'TransactionEvent',
         jsonb_build_object('action', 'ADD',
                            'bizStep', 'urn:epcglobal:cbv:bizstep:selling',
                            'disposition', 'urn:epcglobal:cbv:disp:sold',
                            'transactionId', order_id, 'buyerId', buyer_id,
                            'quantity', 1, 'amountPence', price_pence),
         buyer_id
  FROM fixture_sale;

-- A passport a visitor registered: no catalogue tag, so no correction may
-- touch it, and it has no origin after the migration.
INSERT INTO material_passports (product_name, category_l1, status, organisation_id, registered_by,
                                deconstruction_method, reclaimed_by, condition_grade)
  SELECT 'Upgrade Fixture Visitor Beam', 'structural-timber', 'active', p.organisation_id,
         p.registered_by, 'selective', 'A visitor', 'B'
  FROM material_passports p WHERE p.custom_attributes->>'seedSource' IS NOT NULL
  ORDER BY p.created_at LIMIT 1;

-- A lot the seller cancelled, so the previous release's top-up creates a new
-- one on the new schema, as it would during a rollback window.
UPDATE listings l SET status = 'cancelled'
  FROM material_passports p
  WHERE l.passport_id = p.id AND p.product_name LIKE 'Reclaimed Facing Bricks%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL AND l.status = 'active';
UPDATE material_passports p SET status = 'active'
  FROM listings l WHERE l.passport_id = p.id AND l.status = 'cancelled';

SELECT 'completed sales: ' || (SELECT count(*) FROM transactions WHERE status = 'completed')
       || '; selling events with a buyer: '
       || (SELECT count(*) FROM passport_events WHERE event_data ? 'buyerId')
       || '; drafts: ' || (SELECT count(*) FROM material_passports WHERE status = 'draft')
       || '; visitor passports: '
       || (SELECT count(*) FROM material_passports WHERE custom_attributes->>'seedSource' IS NULL);
