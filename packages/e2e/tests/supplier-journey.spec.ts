import { test, expect } from '@playwright/test';
import { statePath } from '../fixtures/accounts';
import { uniqueName, PNG_1x1 } from '../fixtures/test-helpers';

test.use({ storageState: statePath('supplier') });

/**
 * The full seller journey through the UI: a seeded supplier creates a material
 * passport (no photos), sees the simulated trust state, adds a photo, and lists
 * it on the marketplace.
 */
test('supplier creates a passport, adds a photo, and lists it', async ({ page }) => {
  const name = uniqueName('E2E Supplier Beam');

  // Lands on the materials hub.
  await page.goto('/passports');
  await expect(page).toHaveURL(/\/passports\/?$/);
  await page.getByRole('link', { name: /register material/i }).click();
  await expect(page).toHaveURL(/\/passports\/new/);

  // Step 1 — required fields only.
  await page.locator('#productName').fill(name);
  await page.locator('#categoryL1').selectOption({ index: 1 });

  // Drive the wizard to completion: Continue through the optional steps, submit
  // on review, stop at verification. Count-agnostic to avoid step-timing races;
  // force:true sidesteps the fixed FeedbackWidget overlapping bottom buttons.
  const openPassport = page.getByRole('button', { name: /open passport/i });
  for (let i = 0; i < 8; i++) {
    if (await openPassport.isVisible().catch(() => false)) break;
    const submit = page.getByRole('button', { name: /^register material$/i });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click({ force: true });
      continue;
    }
    const cont = page.getByRole('button', { name: 'Continue' });
    if (await cont.isVisible().catch(() => false)) {
      await cont.click({ force: true });
      continue;
    }
    await page.waitForTimeout(300);
  }

  // Verification: simulated trust layer, no real tx required.
  await expect(openPassport).toBeVisible();
  await expect(
    page.getByText(/Provenance record prepared|Trust layer prepared/i).first(),
  ).toBeVisible();
  await openPassport.click({ force: true });
  await expect(page).toHaveURL(/\/passports\/[0-9a-f-]+$/i);

  // Add one photo via the hidden file input; wait for the upload to complete.
  const [uploadRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/photos') && r.request().method() === 'POST'),
    page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 }),
  ]);
  expect(uploadRes.ok()).toBeTruthy();

  // Back on the list, the material can now be listed (photo present).
  await page.goto('/passports');
  const row = page.locator('li', { hasText: name });
  await expect(row.getByRole('link', { name: /list for sale/i })).toBeVisible();
  await row.getByRole('link', { name: /list for sale/i }).click();
  await expect(page).toHaveURL(/\/listings\/new/);

  // Publish the listing.
  await page.locator('#price').fill('125.00');
  await page.getByRole('button', { name: /create listing/i }).click({ force: true });
  await expect(page).toHaveURL(/\/listings\/?$/);
  await expect(page.getByText(name).first()).toBeVisible();
});
