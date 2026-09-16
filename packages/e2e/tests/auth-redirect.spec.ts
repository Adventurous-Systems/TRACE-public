import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { ACCOUNTS, statePath } from '../fixtures/accounts';

/**
 * Slice 5: a logged-out visitor who deep-links to a protected page is sent
 * to /login and returned to that same page after signing in, instead of
 * landing on their role's default page. Runs with no storageState (a fresh,
 * logged-out context), so it is NOT @smoke — assert-smoke-isolation.ts only
 * allows anonymous, non-mutating probes.
 *
 * The two tests below that sign in mock POST /api/v1/auth/login rather than
 * hitting the real endpoint. That endpoint has its own 10/min-per-IP rate
 * limit, shared across every spec in the suite that logs in — CI runs it
 * tight enough that this file's own sign-ins were enough to push it over.
 * A mocked response exercises the exact same client code (onSubmit →
 * saveSession → router.push(nextTarget ?? getPostAuthRedirect(user))) as a
 * real one; what's under test here is that redirect logic, not whether
 * bcrypt authentication works — global-setup's own mint already proves the
 * real endpoint accepts these credentials. The mock replays the real,
 * currently-valid buyer token global-setup minted for the `buyer`
 * storageState, so it's a genuine token, never a fabricated one.
 */
function mockedBuyerLoginResponse(): { token: string; user: unknown } {
  const state = JSON.parse(readFileSync(statePath('buyer'), 'utf8')) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  const localStorage = state.origins[0]!.localStorage;
  const token = localStorage.find((e) => e.name === 'trace_token')!.value;
  const user = JSON.parse(localStorage.find((e) => e.name === 'trace_user')!.value) as unknown;
  return { token, user };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: mockedBuyerLoginResponse() }),
    });
  });
});

test.describe('Login return path', () => {
  test('server middleware redirects a protected page to /login?next=... and returns there after sign-in', async ({
    page,
  }) => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);

    await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS.buyer.email);
    await page.getByLabel('Password', { exact: true }).fill('irrelevant-mocked');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/transactions$/);
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
    await page.getByLabel('Password', { exact: true }).fill('irrelevant-mocked');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Falls back to the buyer's role default, never navigates to evil.example.
    await expect(page).toHaveURL(/\/marketplace$/);
  });
});
