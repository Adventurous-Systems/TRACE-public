import { test, expect, request as pwRequest } from '@playwright/test';
import { API_URL, statePath } from '../fixtures/accounts';
import { createListedPassport, sessionToken } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * A reported problem, from the buyer's report to the platform admin's
 * decision and back. Before 2026-10-02 "Report a problem" sent no reason, a
 * flagged order could be resolved only through the API, and only one way.
 */
test.describe('Order lifecycle', () => {
  let listingId: string;
  let productName: string;
  const reason = 'E2E: two of the three arrived cracked.';
  const decision = 'E2E: the seller agrees they were damaged.';

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    productName = uniqueName('E2E Disputed Lintel');
    ({ listingId } = await createListedPassport(ctx, sessionToken('supplier'), {
      productName,
      quantity: 3,
    }));

    // The buyer orders all three and the seller accepts: an accepted order
    // is what a problem can be reported on.
    const placed = await ctx.post(`${API_URL}/api/v1/marketplace/offers`, {
      headers: { Authorization: `Bearer ${sessionToken('buyer')}` },
      data: { listingId, quantity: 3 },
    });
    expect(placed.ok(), `place the order (HTTP ${placed.status()})`).toBeTruthy();
    const orderId: string = (await placed.json()).data.id;
    const accepted = await ctx.patch(`${API_URL}/api/v1/marketplace/transactions/${orderId}`, {
      headers: { Authorization: `Bearer ${sessionToken('supplier')}` },
      data: { action: 'accept' },
    });
    expect(accepted.ok(), `accept the order (HTTP ${accepted.status()})`).toBeTruthy();
    await ctx.dispose();
  });

  test('a buyer reports a problem with a reason; the platform admin decides; both read why', async ({
    browser,
  }) => {
    const buyer = await (await browser.newContext({ storageState: statePath('buyer') })).newPage();
    const row = buyer.locator('main ul > li').filter({ hasText: productName });

    // The accepted order says what closes it, and by when.
    await buyer.goto('/transactions');
    await expect(
      row.getByText(/report a problem by .+\. After that the order completes by itself\./),
    ).toBeVisible();

    // Reporting a problem asks what is wrong before anything is sent.
    await row.getByRole('button', { name: 'Report a problem' }).click();
    const send = row.getByRole('button', { name: 'Send report' });
    await expect(send).toBeDisabled();
    await row.getByLabel('What is the problem?').fill(reason);
    await send.click();
    await expect(row.getByText('Problem flagged', { exact: true })).toBeVisible();
    // Said on the order itself (and again in its history, one click away).
    await expect(row.getByText(reason).first()).toBeVisible();

    // The platform admin finds it waiting, with the reason and both parties.
    const admin = await (
      await browser.newContext({ storageState: statePath('platformAdmin') })
    ).newPage();
    await admin.goto('/admin/flagged-orders');
    const waiting = admin
      .getByRole('list', { name: 'Waiting for a decision' })
      .getByRole('listitem')
      .filter({ hasText: productName });
    await expect(waiting.getByText(reason)).toBeVisible();
    await expect(waiting.getByText('Seller', { exact: true })).toBeVisible();

    // A decision needs an outcome and a reason.
    const resolve = waiting.getByRole('button', { name: 'Resolve order' });
    await expect(resolve).toBeDisabled();
    await waiting.getByLabel('Cancel the order').check();
    await expect(resolve).toBeDisabled();
    await waiting.getByLabel('Why').fill(decision);
    await resolve.click();
    await expect(
      admin
        .getByRole('list', { name: 'Resolved' })
        .getByRole('listitem')
        .filter({ hasText: productName }),
    ).toContainText('Resolved: order cancelled');

    // The buyer reads the outcome and why; the quantity is back on sale.
    await buyer.reload();
    await expect(row.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(
      row.getByText('The platform resolved the reported problem: the order is cancelled.'),
    ).toBeVisible();
    await expect(row.getByText(decision).first()).toBeVisible();
    const lot = await (
      await buyer.request.get(`${API_URL}/api/v1/marketplace/listings/${listingId}`)
    ).json();
    expect(lot.data).toMatchObject({ status: 'active', quantityAvailable: 3 });

    await buyer.context().close();
    await admin.context().close();
  });
});
