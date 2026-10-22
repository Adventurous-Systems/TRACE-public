-- What this checkout's migrations must have done with the data in
-- `before.sql`, and what the previous release must still be able to do on the
-- new schema. `pnpm stack upgrade` runs it after the migrations; an exception
-- fails the rehearsal. Rewrite it with `before.sql`.
--
-- Sessions (M3a): 0015 adds token_version and the login backoff to users.
-- Every account, the fixture's and the seeded personas', starts at version 0
-- with no failures and no backoff, and nothing else about it changes. Then the
-- previous release signs a visitor up on the new schema, as its register does
-- (naming none of the new columns), and the defaults fill them in.

DO $$
DECLARE
  fresh users%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM users
             WHERE token_version <> 0 OR failed_login_count <> 0
                OR failed_login_at IS NOT NULL OR login_backoff_until IS NOT NULL) THEN
    RAISE EXCEPTION 'an existing account did not start at version 0 with no backoff';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users
                 WHERE email = 'upgrade-fixture-visitor@example.com' AND role = 'buyer'
                   AND organisation_id IS NULL AND orders_seen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the visitor''s account changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users
                 WHERE email = 'upgrade-fixture-seller@example.com' AND role = 'supplier'
                   AND organisation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'the promoted seller''s account changed';
  END IF;

  -- The previous release's sign-up, on the new schema.
  INSERT INTO users (email, password_hash, name, role, organisation_id)
    VALUES ('upgrade-fixture-late-visitor@example.com',
            '$2b$10$02xnKRdR3biWegV7liWi7.Lwo5N9ozmh/MGhPxCfM/I2x6lmUpJMW',
            'Upgrade Fixture Late Visitor', 'buyer', NULL)
    RETURNING * INTO fresh;
  IF fresh.token_version <> 0 OR fresh.failed_login_count <> 0
     OR fresh.failed_login_at IS NOT NULL OR fresh.login_backoff_until IS NOT NULL THEN
    RAISE EXCEPTION 'the previous release''s sign-up did not get the defaults';
  END IF;
END $$;

SELECT 'accounts: ' || count(*) || ', all at token version 0 with no backoff; '
       || 'the previous release signs up on the new schema'
  FROM users;
