import { test, expect } from '@playwright/test';
import { ACCOUNTS } from '../fixtures/accounts';

/**
 * Slice 5: a logged-out visitor who deep-links to a protected page is sent
 * to /login and returned to that same page after signing in, instead of
 * landing on their role's default page. Runs with no storageState (a fresh,
 * logged-out context), so it is NOT @smoke — assert-smoke-isolation.ts only
 * allows anonymous, non-mutating probes.
 *
 * These sign in for real (M3a): the session is the httpOnly cookie the API
 * sets, so a mocked login response would leave the browser signed out. CI
 * raises LOGIN_RATE_LIMIT_MAX, so the suite's sign-ins no longer meet the
 * per-IP limit that once made this file mock them.
 */

test.describe('Login return path', () => {
  test('server middleware redirects a protected page to /login?next=... and returns there after sign-in', async ({
    page,
  }) => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);

    await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.buyer.email);
    await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.buyer.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/transactions$/);
    // Signed in by the cookie alone: no token is left where a script can read it.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name.endsWith('trace_session'))).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
    });
    expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('trace_token');
  });

  test('the client-side access-request guard also redirects through /login?next=...', async ({
    page,
  }) => {
    await page.goto('/access-request');
    await expect(page).toHaveURL(/\/login\?next=%2Faccess-request$/);
  });

  test('a backslash-disguised next target is rejected, not followed off-origin', async ({
    page,
  }) => {
    await page.goto('/login?next=%2F%5Cevil.example');

    await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.buyer.email);
    await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.buyer.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Falls back to the buyer's role default, never navigates to evil.example.
    await expect(page).toHaveURL(/\/marketplace$/);
  });
});
