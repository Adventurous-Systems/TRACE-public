-- Sessions (M3a, 2026-10-22). A session token carries the user's
-- token_version; raising it ends every session that user holds, at once.
-- Credential changes raise it: demo:restore's persona fix, credential
-- rotation, and later password reset and revocation. Role and organisation
-- need no bump: each request now reads them from this row.
--
-- The login backoff (D5) counts failed sign-ins per account: after 5 within
-- 15 minutes, sign-in waits until login_backoff_until. There is no hard lockout.
--
-- Expand only: the previous release, which serves during a deploy and is the
-- rollback target, never reads these columns, and the defaults fill them for
-- the rows it inserts.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_backoff_until" timestamp with time zone;
