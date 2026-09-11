import { test } from '@playwright/test';
import { expectNoHorizontalOverflow } from '../../fixtures/test-helpers';

// Public pages must never scroll horizontally on a 375px viewport.
for (const path of ['/', '/login', '/register', '/marketplace']) {
  test(`no horizontal overflow @ ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  });
}
