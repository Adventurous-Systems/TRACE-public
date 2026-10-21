import { test, expect } from '@playwright/test';
import { statePath } from '../fixtures/accounts';

/**
 * Role-scoped navigation: every link leads somewhere the role can use.
 * Suppliers get the seller surface only; hub staff have no Quality link and
 * hub admins no platform-only admin pages, which their APIs refuse (journey
 * audit, 2026-10-13).
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

    test('keeps the hub nav, without Quality (the quality API refuses hub staff)', async ({
      page,
    }) => {
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation').first();
      await expect(nav.getByRole('link', { name: 'Passports' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Quality' })).toHaveCount(0);
    });
  });

  test.describe('hub admin', () => {
    test.use({ storageState: statePath('hubAdmin') });

    test('has Feedback, and not the platform-only admin pages', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation').first();
      await expect(nav.getByRole('link', { name: 'Quality' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Feedback' })).toBeVisible();
      await expect(nav.getByRole('link', { name: /access requests/i })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: /activity & vtho/i })).toHaveCount(0);
      // Typed in directly, the page says it is not theirs instead of showing 403s.
      await page.goto('/admin/activity');
      await expect(page.getByText(/visible to the platform administrator/i)).toBeVisible();
    });
  });
});
