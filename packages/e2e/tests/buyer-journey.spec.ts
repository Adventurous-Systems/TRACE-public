import { test, expect, request as pwRequest } from '@playwright/test';
import { ACCOUNTS, statePath } from '../fixtures/accounts';
import { apiLogin, createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * Both sides of a sale: a logged-in buyer orders part of a supplier's lot,
 * the supplier accepts it, and only then can the buyer confirm delivery.
 */
test.describe('Buyer journey', () => {
  let listingId: string;
  let productName: string;

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
    productName = uniqueName('E2E Buyable Slate');
    ({ listingId } = await createListedPassport(ctx, token, {
      productName,
      pricePence: 250,
      quantity: 10,
      minOrderQuantity: 2,
    }));
    await ctx.dispose();
  });

  test.use({ storageState: statePath('buyer') });

  test('buyer orders part of a lot; the seller accepts; the buyer confirms delivery', async ({
    page,
    browser,
  }) => {
    await page.goto(`/marketplace/${listingId}`);

    // Logged in → real buy action, not the sign-up CTA.
    await expect(page.getByRole('link', { name: /sign up to buy/i })).toHaveCount(0);
    const quantity = page.getByLabel('Quantity');
    await expect(quantity).toHaveValue('2'); // starts at the minimum order
    await quantity.fill('1');
    await expect(page.getByText('The minimum order is 2.')).toBeVisible();
    const order = page.getByRole('button', { name: /order at asking price/i });
    await expect(order).toBeDisabled();

    await quantity.fill('3');
    await expect(page.getByText('£7.50')).toBeVisible(); // 3 × £2.50
    await order.click();
    await expect(page.getByText(/order placed/i).first()).toBeVisible();

    // The rest of the lot stays on sale.
    await page.reload();
    await expect(page.getByText('7 of 10')).toBeVisible();

    await page.goto('/transactions');
    const mine = page.getByRole('listitem').filter({ hasText: productName });
    await expect(mine.getByText('Awaiting seller')).toBeVisible();
    await expect(mine.getByText('Quantity 3')).toBeVisible();
    await expect(mine.getByRole('button', { name: /confirm delivery/i })).toHaveCount(0);

    // The supplier accepts it from their own Orders page.
    const seller = await browser.newContext({ storageState: statePath('supplier') });
    const sellerPage = await seller.newPage();
    await sellerPage.goto('/transactions');
    const incoming = sellerPage.getByRole('listitem').filter({ hasText: productName });
    await incoming.getByRole('button', { name: /accept order/i }).click();
    await expect(incoming.getByText('Accepted', { exact: true })).toBeVisible();
    await seller.close();

    await page.reload();
    await mine.getByRole('button', { name: /confirm delivery/i }).click();
    await expect(mine.getByText('Completed', { exact: true })).toBeVisible();
  });
});
