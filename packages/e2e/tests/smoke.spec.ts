import { test, expect } from '@playwright/test';
import { statePath } from '../fixtures/accounts';

/**
 * Read-only post-deploy smoke checks — safe to run against production.
 * They create NO data; they only confirm the deploy is healthy end-to-end
 * (web render + nginx `/api` routing + auth round-trip).
 */
test.describe('@smoke deploy health', () => {
  test('home renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Get started').first()).toBeVisible();
  });

  test('marketplace renders', async ({ page }) => {
    await page.goto('/marketplace');
    await expect(page.getByPlaceholder(/search materials/i)).toBeVisible();
  });

  test('login renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('register renders', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test.describe('authenticated', () => {
    test.use({ storageState: statePath('supplier') });

    test('supplier dashboard loads (auth + API via domain)', async ({ page }) => {
      await page.goto('/passports');
      await expect(page).toHaveURL(/\/passports/);
      await expect(
        page.getByRole('navigation').first().getByRole('link', { name: 'Passports' }),
      ).toBeVisible();
    });
  });
});
