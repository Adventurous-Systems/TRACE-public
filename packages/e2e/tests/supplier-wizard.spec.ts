import { test, expect } from '@playwright/test';
import { statePath } from '../fixtures/accounts';
import { PNG_1x1, uniqueName } from '../fixtures/test-helpers';

test.use({ storageState: statePath('supplier') });

/**
 * The register wizard with every step filled in, including values it must
 * refuse. Before 2026-10-02 only two fields showed an error: an EPD reference
 * that was not a web address, or a decimal number of years, made "Register
 * material" do nothing at all (owner's manual test, O10 and O11).
 */
test('the wizard shows a problem on its own step, survives a refresh, and registers', async ({
  page,
}) => {
  const name = uniqueName('E2E Wizard Lintel');
  const next = () => page.getByRole('button', { name: 'Continue' }).click({ force: true });

  await page.goto('/passports/new');
  await page.evaluate(() => {
    localStorage.removeItem('trace_register_wizard');
    localStorage.removeItem('trace_register_wizard_step');
  });
  await page.reload();

  // Step 1 — required fields are checked before leaving the step.
  await next();
  await expect(page.getByText('Product name is required')).toBeVisible();
  await page.locator('#productName').fill(name);
  await page.locator('#categoryL1').selectOption({ index: 1 });
  await next();

  // Step 2 — the dimension labels carry the chosen unit.
  await expect(page.getByText('Length (mm)')).toBeVisible();
  await page.locator('#dimensionUnit').selectOption('cm');
  await expect(page.getByText('Length (cm)')).toBeVisible();
  await expect(page.getByText('Height / Depth (cm)')).toBeVisible();
  await page.locator('#dimensionLength').fill('120');
  await page.locator('#dimensionWeight').fill('85');
  await next();

  // Step 3 — a decimal number of years is refused here, with a reason.
  await page.locator('#remainingLifeEstimate').fill('12.5');
  await next();
  await expect(page.getByText('Enter whole years, without a decimal.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Circular economy data' })).toBeVisible();
  await page.locator('#remainingLifeEstimate').fill('12');
  await next();

  // Step 4 — an EPD reference that is not a web address is refused here.
  await expect(page.getByRole('heading', { name: 'Environmental data' })).toBeVisible();
  await page.locator('#epdReference').fill('EPD-12345');
  await next();
  await expect(page.getByText(/full web address of the EPD/)).toBeVisible();

  // A refresh keeps the step and what was entered.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Environmental data' })).toBeVisible();
  await expect(page.locator('#epdReference')).toHaveValue('EPD-12345');

  await page.locator('#epdReference').fill('https://epd.example/e2e-lintel');
  await page.locator('#recycledContent').fill('30');
  await next();

  // "Continue" stops at the review step; it must not register by itself.
  // (It used to: the button turned into the submit button mid-click.)
  await expect(page.getByRole('heading', { name: 'Review & submit' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: 'Review & submit' })).toBeVisible();
  await expect(page.getByRole('button', { name: /open passport/i })).toHaveCount(0);
  await expect(page.getByText(name).first()).toBeVisible();

  // A refresh on the review step stays there too.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review & submit' })).toBeVisible();

  // A photo chosen on the review step is uploaded with the registration.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();

  // Register: the form goes through, and the passport has its photo.
  await page.getByRole('button', { name: /^register material$/i }).click({ force: true });
  const open = page.getByRole('button', { name: /open passport/i });
  await expect(open).toBeVisible();
  await open.click({ force: true });
  await expect(page).toHaveURL(/\/passports\/[0-9a-f-]+$/i);
  await expect(page.getByRole('button', { name: /list for sale/i })).toBeVisible();
  await expect(page.getByText('No photos uploaded yet.')).toHaveCount(0);
});
