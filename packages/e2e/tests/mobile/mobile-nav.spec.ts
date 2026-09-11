import { test, expect } from '@playwright/test';
import { statePath } from '../../fixtures/accounts';
import { expectNoHorizontalOverflow } from '../../fixtures/test-helpers';

test.use({ storageState: statePath('supplier') });

/**
 * On a 375px viewport the desktop nav is hidden; the hamburger must open a
 * working menu, and no key screen may scroll horizontally.
 */
test('hamburger menu navigates and screens do not overflow', async ({ page }) => {
  await page.goto('/passports');
  await expectNoHorizontalOverflow(page);

  // Build-agnostic selectors (work before and after the data-testid ships):
  // the desktop nav is display:none on mobile, so only the opened menu is visible.
  const toggle = page.getByRole('button', { name: /toggle navigation/i });
  await expect(toggle).toBeVisible();
  await toggle.click();

  await page.locator('nav:visible').getByRole('link', { name: 'Listings' }).click();
  await expect(page).toHaveURL(/\/listings/);
  await expectNoHorizontalOverflow(page);
});

test('marketplace has no horizontal overflow on mobile', async ({ page }) => {
  await page.goto('/marketplace');
  await expectNoHorizontalOverflow(page);
});
