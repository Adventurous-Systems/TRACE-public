import { test, expect, request as pwRequest } from '@playwright/test';
import { ACCOUNTS, API_URL, statePath } from '../fixtures/accounts';
import { apiLogin, createPassportNoPhoto } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * A material must have at least one photo before it can be listed.
 * Verified at the API boundary (authoritative) and in the seller UI.
 */
test.describe('Listing requires a photo', () => {
  test('API rejects listing a photoless passport with 409', async () => {
    const ctx = await pwRequest.newContext();
    const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
    const passportId = await createPassportNoPhoto(ctx, token, uniqueName('E2E NoPhoto'));

    const res = await ctx.post(`${API_URL}/api/v1/marketplace/listings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        passportId,
        pricePence: 10000,
        currency: 'GBP',
        quantity: 1,
        shippingOptions: [{ method: 'collection' }],
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.message).toMatch(/at least one material photo/i);
    await ctx.dispose();
  });

  test.describe('seller UI gates the action', () => {
    test.use({ storageState: statePath('supplier') });

    test('photoless passport shows "Add a photo to list"', async ({ page }) => {
      // Create a photoless passport via API, then view the list.
      const ctx = await pwRequest.newContext();
      const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
      const name = uniqueName('E2E UI NoPhoto');
      await createPassportNoPhoto(ctx, token, name);
      await ctx.dispose();

      await page.goto('/passports');
      const row = page.locator('li', { hasText: name });
      await expect(row.getByRole('link', { name: /add a photo to list/i })).toBeVisible();
      await expect(row.getByRole('link', { name: /list for sale/i })).toHaveCount(0);
    });
  });
});
