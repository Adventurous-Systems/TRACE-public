import { test, expect, type Page } from '@playwright/test';
import { statePath, type Role } from '../fixtures/accounts';

/**
 * The accounts with the most navigation links: at common laptop widths the
 * header's parts must not run into each other (owner's test O3: at 1366px
 * the hub admin's email ran into "Activity & VTHO").
 */
const WIDTHS = [1280, 1366, 1536];
const ROLES: Role[] = ['hubAdmin', 'platformAdmin'];

async function visibleBox(page: Page, selector: string) {
  const el = page.locator(selector).first();
  if (!(await el.isVisible())) return null;
  return el.boundingBox();
}

for (const role of ROLES) {
  test.describe(`${role} header`, () => {
    test.use({ storageState: statePath(role) });

    for (const width of WIDTHS) {
      test(`fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/dashboard');
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

        const nav = await visibleBox(page, 'header nav');
        const right = await visibleBox(page, 'header > div > div:last-child');
        const logo = await visibleBox(page, 'header a[aria-label="TRACE home"]');
        expect(right).not.toBeNull();
        expect(logo).not.toBeNull();
        // The links end before the email and Sign out begin.
        if (nav) expect(nav.x + nav.width).toBeLessThanOrEqual(right!.x);
        expect(logo!.x + logo!.width).toBeLessThanOrEqual((nav ?? right)!.x);
        // Nothing pushes the page sideways.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
