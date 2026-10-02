-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.

DO $$
DECLARE
  fixtures int;
  overdue int;
  short int;
BEGIN
  SELECT count(*) INTO fixtures FROM transactions WHERE notes LIKE 'upgrade fixture:%';
  IF fixtures <> 5 THEN
    RAISE EXCEPTION 'expected 5 fixture orders, found %', fixtures;
  END IF;

  -- 0012: nothing lapses or completes the moment the new release starts.
  -- Every order already open has a full period ahead of it.
  SELECT count(*) INTO overdue FROM transactions
    WHERE (status = 'pending'
           AND coalesce(response_deadline, created_at + interval '72 hours') <= now())
       OR (status = 'confirmed' AND dispute_deadline <= now());
  IF overdue > 0 THEN
    RAISE EXCEPTION '% open order(s) would be closed by a time limit at once', overdue;
  END IF;

  SELECT count(*) INTO short FROM transactions
    WHERE notes LIKE 'upgrade fixture:%'
      AND ((status = 'pending' AND response_deadline < now() + interval '71 hours')
        OR (status = 'confirmed' AND dispute_deadline < now() + interval '23 hours'));
  IF short > 0 THEN
    RAISE EXCEPTION '% open order(s) were given less than a full period', short;
  END IF;

  -- A flagged order stays flagged: it waits for the platform admin, not a limit.
  IF (SELECT status FROM transactions WHERE notes = 'upgrade fixture: disputed') <> 'disputed' THEN
    RAISE EXCEPTION 'the flagged order changed state';
  END IF;
END $$;

-- The previous release serves during a deploy and is the rollback target. It
-- knows neither the deadline column nor the steps table: it places an order
-- and accepts another without them.
INSERT INTO transactions (listing_id, buyer_id, seller_id, amount_pence, quantity, status, notes)
  SELECT t.listing_id, t.buyer_id, t.seller_id, l.price_pence, 1, 'pending',
         'upgrade fixture: placed by the previous release, after the upgrade'
  FROM transactions t JOIN listings l ON l.id = t.listing_id
  WHERE t.notes = 'upgrade fixture: pending';
UPDATE listings l SET quantity_available = quantity_available - 1
  FROM transactions t
  WHERE t.listing_id = l.id AND t.notes = 'upgrade fixture: pending';

SELECT 'order: ' || rpad(t.status, 10) || ' answer by ' || coalesce(to_char(t.response_deadline, 'DD Mon HH24:MI'), '(placed + 72 h)')
       || ', problem window to ' || coalesce(to_char(t.dispute_deadline, 'DD Mon HH24:MI'), '-')
       || ', ' || (SELECT count(*) FROM order_events e WHERE e.transaction_id = t.id) || ' step(s) recorded'
       || '  [' || replace(t.notes, 'upgrade fixture: ', '') || ']'
  FROM transactions t
  WHERE t.notes LIKE 'upgrade fixture:%'
  ORDER BY t.created_at, t.status;
