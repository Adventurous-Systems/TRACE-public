-- Data as the release that is live can leave it. `pnpm stack upgrade` applies
-- this to a scratch database built and seeded by that release, then runs this
-- checkout's migrations over it, so they meet old data before production does.
--
-- REWRITE THIS FOR EACH MILESTONE. It must use only columns the live release
-- has, and hold whatever the new migrations will touch. `after.sql` then
-- checks what they did with it.
--
-- Written for: sessions (M3a). The live release is M2 (#99, migrations to
-- 0014). M3a's 0015 adds four columns to users: token_version, and the login
-- backoff (failed_login_count, failed_login_at, login_backoff_until), each with
-- a default or nullable. So the fixture holds accounts in the shapes the live
-- release leaves them, besides the seeded personas:
--   a visitor who signed up and has opened their orders (buyer, no organisation);
--   a visitor an access request promoted (supplier, with an organisation).
-- Earlier fixtures are in this file's history.

-- A bcrypt hash of nothing anyone uses: these accounts never sign in here.
INSERT INTO users (email, password_hash, name, role, organisation_id, orders_seen_at)
  VALUES ('upgrade-fixture-visitor@example.com',
          '$2b$10$02xnKRdR3biWegV7liWi7.Lwo5N9ozmh/MGhPxCfM/I2x6lmUpJMW',
          'Upgrade Fixture Visitor', 'buyer', NULL, now());

INSERT INTO users (email, password_hash, name, role, organisation_id)
  SELECT 'upgrade-fixture-seller@example.com',
         '$2b$10$02xnKRdR3biWegV7liWi7.Lwo5N9ozmh/MGhPxCfM/I2x6lmUpJMW',
         'Upgrade Fixture Seller', 'supplier', o.id
  FROM organisations o ORDER BY o.created_at LIMIT 1;

SELECT 'accounts: ' || count(*) || ' (' || string_agg(DISTINCT role, ', ' ORDER BY role) || ')'
  FROM users;
