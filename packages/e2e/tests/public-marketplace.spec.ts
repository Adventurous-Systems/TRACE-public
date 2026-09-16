import { test, expect, request as pwRequest } from '@playwright/test';
import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * Logged-out public journey: browse the marketplace, open a listing, see the
 * linked passport's trust panel, and get a sign-up CTA instead of a buy button.
 */
test.describe('Public marketplace (logged out)', () => {
  let listingId: string;
  let passportId: string;
  let productName: string;

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
    productName = uniqueName('E2E Public Brick');
    ({ listingId, passportId } = await createListedPassport(ctx, token, { productName }));
    await ctx.dispose();
  });

  test('marketplace shows the published material', async ({ page }) => {
    await page.goto('/marketplace');
    await expect(page.getByText(productName).first()).toBeVisible();
  });

  test('listing detail shows a sign-up CTA, not a buy button', async ({ page }) => {
    await page.goto(`/marketplace/${listingId}`);
    await expect(page.getByText(productName).first()).toBeVisible();

    const cta = page.getByRole('link', { name: /sign up to buy this material/i });
    await expect(cta).toBeVisible();
    await expect(page.getByRole('button', { name: /make offer/i })).toHaveCount(0);

    await cta.click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('linked passport shows a trust/provenance panel', async ({ page }) => {
    await page.goto(`/passport/${passportId}`);
    await expect(
      page.getByText(/Trust layer prepared|Blockchain verified|Pending verification/).first(),
    ).toBeVisible();
  });

  // The category filter used to offer all ten top-level categories from
  // MATERIAL_CATEGORIES regardless of whether any of them had stock, so most
  // selections dead-ended on "No listings match your search." It's now
  // narrowed to /api/v1/marketplace/facets — this only checks that the
  // narrowing actually ran (fewer than the full list), not an exact demo
  // count, since the live catalogue here also includes this spec's own
  // 'masonry' fixture plus whatever else the environment seeded.
  test('category filter is narrowed to categories with stock', async ({ page }) => {
    await page.goto('/marketplace');
    const options = page.getByLabel('Filter by category').locator('option');
    await expect(options).not.toHaveCount(11); // 10 categories + "All categories"
    await expect(page.getByLabel('Filter by category')).toContainText('Structural Steel');
  });
});
