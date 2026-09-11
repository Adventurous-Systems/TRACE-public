import { test, expect } from '@playwright/test';
import { statePath } from '../fixtures/accounts';

/**
 * Role-scoped navigation: suppliers get the seller surface only (no admin,
 * no quality tooling); hub staff keep their full hub navigation.
 */
test.describe('Role-based navigation', () => {
  test.describe('supplier', () => {
    test.use({ storageState: statePath('supplier') });

    test('sees seller nav and no admin/quality links', async ({ page }) => {
      await page.goto('/passports');
      const nav = page.getByRole('navigation').first();
      await expect(nav.getByRole('link', { name: 'Passports' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Listings' })).toBeVisible();
      await expect(nav.getByRole('link', { name: /access requests/i })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: /activity & vtho/i })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Quality' })).toHaveCount(0);
    });
  });

  test.describe('hub staff', () => {
    test.use({ storageState: statePath('hubStaff') });

    test('keeps the full hub nav including Quality', async ({ page }) => {
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation').first();
      await expect(nav.getByRole('link', { name: 'Passports' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Quality' })).toBeVisible();
    });
  });
});
