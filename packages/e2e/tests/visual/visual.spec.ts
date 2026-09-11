import { test, expect } from '@playwright/test';
import { statePath } from '../../fixtures/accounts';

/**
 * Visual-regression baselines for deterministic, data-free screens (layout/CSS
 * regressions). Data-heavy pages (marketplace cards, listing/passport detail)
 * are intentionally excluded for now — they need masking of dynamic content.
 *
 * Runs under both `desktop-chromium` and `mobile-375`; Playwright writes a
 * per-project baseline. Generate inside the pinned Playwright container so the
 * snapshots match CI rendering:
 *   docker run --rm --network host \
 *     -e RUN_VISUAL=1 -e E2E_BASE_URL=… -e E2E_API_URL=… \
 *     -v <repo>:/work -w /work/packages/e2e \
 *     mcr.microsoft.com/playwright:v1.60.0-jammy \
 *     npx playwright test tests/visual --update-snapshots
 *
 * These specs are skipped unless RUN_VISUAL=1, so they don't run on the bare CI
 * runner (whose font rendering would not match the container-generated baselines).
 */

test.describe('Visual — public pages', () => {
  test.skip(
    !process.env.RUN_VISUAL,
    'Visual snapshots run on demand (RUN_VISUAL=1, pinned container).',
  );

  const pages: ReadonlyArray<readonly [string, string]> = [
    ['home', '/'],
    ['login', '/login'],
    ['register', '/register'],
  ];

  for (const [name, path] of pages) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }
});

test.describe('Visual — seller pages', () => {
  test.skip(
    !process.env.RUN_VISUAL,
    'Visual snapshots run on demand (RUN_VISUAL=1, pinned container).',
  );
  test.use({ storageState: statePath('supplier') });

  test('passport-wizard', async ({ page }) => {
    await page.goto('/passports/new');
    await expect(page.getByText('Basic information')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // let the client-hydrated live-preview sidebar settle before snapshotting
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('passport-wizard.png', { fullPage: true });
  });
});
