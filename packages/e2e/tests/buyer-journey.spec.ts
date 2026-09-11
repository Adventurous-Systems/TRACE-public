import { test, expect, request as pwRequest } from '@playwright/test';
import { ACCOUNTS, statePath } from '../fixtures/accounts';
import { apiLogin, createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * Buyer side of the loop: a logged-in buyer opens a supplier's listing, sees a
 * real "Make offer" action (not the sign-up CTA), places an offer, and finds it
 * in their Orders.
 */
test.describe('Buyer journey', () => {
  let listingId: string;
  let productName: string;

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
    productName = uniqueName('E2E Buyable Slate');
    ({ listingId } = await createListedPassport(ctx, token, { productName }));
    await ctx.dispose();
  });

  test.use({ storageState: statePath('buyer') });

  test('buyer places an offer and sees it in Orders', async ({ page }) => {
    await page.goto(`/marketplace/${listingId}`);

    // Logged in → real buy action, not the sign-up CTA.
    await expect(page.getByRole('link', { name: /sign up to buy/i })).toHaveCount(0);
    const offer = page.getByRole('button', { name: /make offer/i });
    await expect(offer).toBeVisible();
    await offer.click();

    await expect(page.getByText(/offer placed/i).first()).toBeVisible();

    // The Orders list shows the order (price + buyer role), not the passport name.
    await page.goto('/transactions');
    await expect(page.getByText(/you are buyer/i).first()).toBeVisible();
  });
});
