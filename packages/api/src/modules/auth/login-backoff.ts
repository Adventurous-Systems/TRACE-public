import { eq, sql } from 'drizzle-orm';
import { db, users } from '@trace/db';

/**
 * Login backoff per account (M3a, owner decision D5, 2026-10-22). After 5
 * failed sign-ins in a row, the account waits before the next attempt: 1
 * minute, then 2, 4, 8, and at most 15. A failure continues the run if it
 * comes within 15 minutes of the last failure, or of the end of the last
 * wait; a successful sign-in ends it. There is no hard lockout: anyone who
 * knows an email could otherwise keep that account locked.
 *
 * Unknown emails get only the per-IP limit (auth.routes.ts), and login checks
 * a dummy hash for them, so a probe with a made-up email never backs off.
 */
export const FREE_FAILURES = 5;
export const RUN_WINDOW_MINUTES = 15;
export const MAX_WAIT_MINUTES = 15;

/** The wait after an account's `failures`th failure in a row, in minutes. */
export function waitMinutes(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(2 ** (failures - FREE_FAILURES), MAX_WAIT_MINUTES);
}

/**
 * Counts a failed sign-in, in one statement so concurrent guesses can't
 * undercount. On the right-hand side of SET, columns hold their old values.
 */
export async function recordFailedLogin(userId: string): Promise<void> {
  const runContinues = sql`${users.failedLoginAt} is not null and now() <= greatest(${users.failedLoginAt}, coalesce(${users.loginBackoffUntil}, ${users.failedLoginAt})) + make_interval(mins => ${RUN_WINDOW_MINUTES}::int)`;
  const failures = sql`(case when ${runContinues} then ${users.failedLoginCount} + 1 else 1 end)`;
  await db
    .update(users)
    .set({
      failedLoginCount: failures,
      failedLoginAt: sql`now()`,
      loginBackoffUntil: sql`case when ${failures} >= ${FREE_FAILURES}::int
        then now() + make_interval(mins => least(power(2, ${failures} - ${FREE_FAILURES}::int)::int, ${MAX_WAIT_MINUTES}::int))
        else null end`,
    })
    .where(eq(users.id, userId));
}

/** A successful sign-in ends the run. */
export async function clearFailedLogins(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginCount: 0, failedLoginAt: null, loginBackoffUntil: null })
    .where(eq(users.id, userId));
}
