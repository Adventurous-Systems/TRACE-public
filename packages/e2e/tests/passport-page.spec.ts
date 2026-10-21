import { test, expect, request as pwRequest } from '@playwright/test';
import { sessionToken, createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * The public passport tells the whole story, consistently, and loads cleanly
 * for a reader far from the UK (journey audit, 2026-10-13): its material
 * data, where it comes from, one registration date, and a way back to its
 * listing. A date formatted without a zone made the server and the browser
 * disagree (React's hydration error #418), so this reader is in Auckland.
 */
test.use({ timezoneId: 'Pacific/Auckland' });

test.describe('Public passport', () => {
  let listingId: string;
  let passportId: string;
  const productName = uniqueName('E2E Passport Brick');

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    ({ listingId, passportId } = await createListedPassport(ctx, sessionToken('supplier'), {
      productName,
      pricePence: 360,
      passport: {
        origin: 'surplus',
        reclaimedBy: 'A builder merchant',
        remainingLifeEstimate: 60,
        circularityScore: 80,
        reuseSuitability: ['feature-wall'],
        materialComposition: [{ material: 'Fired clay', percentage: 100, recycled: false }],
        dimensions: { length: 215, width: 102.5, height: 65, unit: 'mm' },
        technicalSpecs: { compressiveStrength: '30 N/mm²', grade: 'B' },
      },
    }));
    await ctx.dispose();
  });

  test('shows its data, its origin, and one registration date, without errors', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /hydrat|#418|#425/i.test(m.text())) problems.push(m.text());
    });
    await page.goto(`/passport/${passportId}`);
    const main = page.locator('main');
    await expect(main.getByText(productName).first()).toBeVisible();
    await expect(main.getByText('Surplus (unused stock)').first()).toBeVisible();
    await expect(main.getByText('Surplus stock, never fitted')).toBeVisible();
    await expect(main.getByText('Surplus from')).toBeVisible();
    await expect(main.getByText('Fired clay')).toBeVisible();
    await expect(main.getByText('215 × 102.5 × 65 mm')).toBeVisible();
    await expect(main.getByText('Compressive strength')).toBeVisible();
    await expect(main.getByText('80 / 100')).toBeVisible();
    await expect(main.getByText('Feature wall')).toBeVisible();
    // A spec's grade is never shown: the condition grade owns it.
    await expect(main.getByText('Material and specifications')).toBeVisible();
    await expect(main.locator('dt', { hasText: /^Grade$/ })).toHaveCount(0);
    await expect(main.getByText('No circular data recorded')).toHaveCount(0);
    await expect(main.getByText(/^Registered on$/)).toHaveCount(0);
    await expect(main.getByText('Listed on the marketplace')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('leads back to its listing and to the marketplace', async ({ page }) => {
    await page.goto(`/passport/${passportId}`);
    await page.getByRole('link', { name: /view listing/i }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${listingId}$`));
    await page.goto(`/passport/${passportId}`);
    await page.getByRole('link', { name: '← Marketplace' }).click();
    await expect(page).toHaveURL(/\/marketplace$/);
  });
});
