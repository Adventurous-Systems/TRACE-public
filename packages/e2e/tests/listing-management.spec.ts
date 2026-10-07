import { test, expect, request as pwRequest } from '@playwright/test';
import { API_URL, statePath } from '../fixtures/accounts';
import { createListedPassport, sessionToken } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * A seller changes a lot's terms on a screen of their own. Before 2026-10-06
 * there was no such screen, and a fully-ordered lot could not be changed at
 * all, not even to add stock (rehearsal F6).
 */
test.describe('Listing management', () => {
  let listingId: string;
  let productName: string;

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    productName = uniqueName('E2E Managed Lintel');
    ({ listingId } = await createListedPassport(ctx, sessionToken('supplier'), {
      productName,
      pricePence: 400,
      quantity: 3,
    }));
    // A buyer orders all three: the lot is fully ordered and off the marketplace.
    const placed = await ctx.post(`${API_URL}/api/v1/marketplace/offers`, {
      headers: { Authorization: `Bearer ${sessionToken('buyer')}` },
      data: { listingId, quantity: 3 },
    });
    expect(placed.ok(), `place the order (HTTP ${placed.status()})`).toBeTruthy();
    await ctx.dispose();
  });

  test('a seller adds stock to a fully-ordered lot and changes its price', async ({ browser }) => {
    const seller = await (
      await browser.newContext({ storageState: statePath('supplier') })
    ).newPage();
    const row = seller.locator('main ul > li').filter({ hasText: productName });

    await seller.goto('/listings');
    await expect(row.getByText('Fully ordered', { exact: true })).toBeVisible();
    await row.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(seller.getByText(/every unit of this lot is ordered/i)).toBeVisible();

    // The form says what bounds the quantity, and holds to it.
    await expect(
      seller.getByText(/orders hold 3, so the quantity can't go below that/i).first(),
    ).toBeVisible();
    await seller.locator('#quantity').fill('2');
    await seller.getByRole('button', { name: 'Save changes' }).click();
    await expect(seller.locator('main form [role=alert]')).toContainText("can't go below");

    await seller.locator('#quantity').fill('8');
    await seller.locator('#price').fill('3.50');
    await seller.getByRole('button', { name: 'Save changes' }).click();
    await seller.waitForURL(/\/listings$/);
    await expect(row.getByText('On sale', { exact: true })).toBeVisible();
    await expect(row).toContainText('5 of 8 left');
    await expect(row).toContainText('£3.50');

    // The buyer's order keeps the price it was placed at.
    const orders = await (
      await seller.request.get(`${API_URL}/api/v1/marketplace/transactions`, {
        headers: { Authorization: `Bearer ${sessionToken('buyer')}` },
      })
    ).json();
    const order = (orders.data as Array<{ listingId: string; amountPence: number }>).find(
      (o) => o.listingId === listingId,
    );
    expect(order?.amountPence).toBe(1200);

    await seller.context().close();
  });

  test("another organisation's seller can't open the edit form", async ({ browser }) => {
    const other = await (
      await browser.newContext({ storageState: statePath('hubStaff') })
    ).newPage();
    await other.goto(`/listings/${listingId}/edit`);
    await expect(other.getByText('This listing belongs to another organisation.')).toBeVisible();
    await expect(other.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await other.context().close();
  });
});
