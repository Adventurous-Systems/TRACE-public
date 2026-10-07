-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.
--
-- Listing management has no migration: the data must come through unchanged.
-- Then the edits this release makes (a fully-ordered lot given more stock, an
-- expired lot put back on sale with no end date) are written as it writes
-- them, and the previous release (the rollback target) orders from the
-- revived lot and creates lots around them; the invariant check follows.

DO $$
DECLARE
  fixtures int;
  overdue int;
BEGIN
  SELECT count(*) INTO fixtures FROM transactions WHERE notes LIKE 'upgrade fixture:%';
  IF fixtures <> 5 THEN
    RAISE EXCEPTION 'expected 5 fixture orders, found %', fixtures;
  END IF;

  SELECT count(*) INTO overdue FROM transactions
    WHERE (status = 'pending' AND response_deadline <= now())
       OR (status = 'confirmed' AND dispute_deadline <= now());
  IF overdue > 0 THEN
    RAISE EXCEPTION '% open order(s) would be closed by a time limit at once', overdue;
  END IF;

  IF (SELECT count(*) FROM listings WHERE status = 'reserved') <> 1
     OR (SELECT count(*) FROM listings WHERE status = 'expired') <> 1 THEN
    RAISE EXCEPTION 'the fully-ordered or the expired lot changed state';
  END IF;
END $$;

-- This release: two more staircases on the fully-ordered lot (D1)...
UPDATE listings l SET quantity = l.quantity + 2, quantity_available = 2, status = 'active'
  WHERE l.status = 'reserved';
UPDATE material_passports p SET status = 'listed'
  FROM listings l WHERE l.passport_id = p.id AND p.status = 'reserved' AND l.status = 'active';
-- ...and the expired lot back on sale with no end date (D3).
UPDATE material_passports p SET status = 'listed'
  FROM listings l WHERE l.passport_id = p.id AND l.status = 'expired';
UPDATE listings SET status = 'active', expires_at = NULL WHERE status = 'expired';

-- The previous release orders from the revived lot, as it places any order.
INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, quantity, status,
                          response_deadline, notes)
  SELECT l.id, buyer.id, l.seller_id, l.price_pence, 1, 'pending', now() + interval '72 hours',
         'upgrade fixture: placed by the previous release on a revived lot'
  FROM listings l JOIN material_passports p ON p.id = l.passport_id, users buyer
  WHERE p.product_name LIKE 'Reclaimed Aluminium Stud Walling%'
    AND p.custom_attributes->>'seedSource' IS NOT NULL AND l.status = 'active'
    AND buyer.email = 'buyer@example.com';
UPDATE listings l SET quantity_available = quantity_available - 1
  FROM transactions t
  WHERE t.listing_id = l.id AND t.notes = 'upgrade fixture: placed by the previous release on a revived lot';

SELECT 'lot: ' || rpad(left(p.product_name, 34), 35) || rpad(l.status, 9) || l.quantity_available
       || ' of ' || l.quantity || ' left, ends ' || coalesce(to_char(l.expires_at, 'DD Mon'), 'never')
  FROM listings l JOIN material_passports p ON p.id = l.passport_id
  WHERE p.product_name LIKE 'Reclaimed Prefabricated Staircase%'
     OR p.product_name LIKE 'Reclaimed Aluminium Stud Walling%'
  ORDER BY 1;
