import { test, expect, request as pwRequest } from '@playwright/test';
import { ACCOUNTS, statePath } from '../fixtures/accounts';
import { apiLogin, createListedPassport } from '../fixtures/api';
import { uniqueName } from '../fixtures/test-helpers';

/**
 * The inspector's journey: find a material without knowing its ID, see what
 * is being inspected, file a report, and the public passport then says an
 * independent inspection set the grade. Before 2026-10-02 a new report began
 * with a field asking for the passport's UUID.
 */
test.describe('Inspector journey', () => {
  let passportId: string;
  let productName: string;

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext();
    const token = await apiLogin(ctx, ACCOUNTS.supplier.email, ACCOUNTS.supplier.password);
    productName = uniqueName('E2E Inspectable Joist');
    ({ passportId } = await createListedPassport(ctx, token, { productName }));
    await ctx.dispose();
  });

  test.use({ storageState: statePath('inspector') });

  test('an inspector finds a material by name, inspects it, and the passport shows it', async ({
    page,
    browser,
  }) => {
    // The dashboard is a work queue, with no failed request behind it.
    const failures: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Next to inspect')).toBeVisible();
    await expect(page.getByText('Not yet independently inspected').first()).toBeVisible();
    expect(failures).toEqual([]);

    // Start a report from the reports page; no ID to type.
    await page.goto('/quality');
    await page
      .getByRole('link', { name: /new report/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/quality\/new/);
    await expect(page.getByLabel('Passport ID')).toHaveCount(0);
    const submit = page.getByRole('button', { name: /submit report/i });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Search materials').fill(productName);
    const found = page.getByRole('list', { name: 'Materials' }).getByRole('listitem');
    await expect(found).toHaveCount(1);
    await expect(found.getByText('Not yet independently inspected')).toBeVisible();
    await found.getByRole('button', { name: 'Inspect' }).click();

    // The material stays in view while it is scored.
    await expect(page.getByText('Material being inspected')).toBeVisible();
    await expect(page.getByText(productName).first()).toBeVisible();
    await expect(page.getByText('None. This will be the first.')).toBeVisible();

    await page.locator('#structuralScore').fill('8');
    await page.getByRole('button', { name: /^C\s*Fair$/ }).click();
    await page.locator('textarea').first().fill('E2E: sound, with surface weathering.');
    await submit.click();

    // The reports list names the material, not its ID.
    await expect(page).toHaveURL(/\/quality$/);
    await expect(page.getByRole('link', { name: productName })).toBeVisible();

    // A visitor sees who set the grade, and never the inspector's email.
    const visitor = await browser.newContext();
    const passport = await visitor.newPage();
    await passport.goto(`/passport/${passportId}`);
    await expect(passport.getByText(/Set by independent inspection on/)).toBeVisible();
    await expect(passport.getByText(/independent quality auditor/)).toBeVisible();
    await expect(passport.getByText('E2E: sound, with surface weathering.')).toBeVisible();
    await expect(passport.getByText(ACCOUNTS.inspector.email)).toHaveCount(0);
    await visitor.close();

    // It left the queue of materials not yet inspected.
    await page.goto('/quality/new');
    await page.getByLabel('Only materials not yet independently inspected').check();
    await page.getByLabel('Search materials').fill(productName);
    await expect(page.getByText(/No registered material matches/)).toBeVisible();
  });
});
