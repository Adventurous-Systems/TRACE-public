import { test, expect, type Page } from '@playwright/test';
import { statePath } from '../fixtures/accounts';

async function expectDecodedLogo(page: Page): Promise<void> {
  const logo = page.getByRole('img', { name: 'TRACE', exact: true }).first();
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty('complete', true);
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalHeight))
    .toBeGreaterThan(0);
}

/**
 * Read-only post-deploy smoke checks — safe to run against production.
 * They create NO data; they only confirm the deploy is healthy end-to-end
 * (web render + nginx `/api` routing + auth round-trip).
 */
test.describe('deploy health', () => {
  test('@smoke home renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Get started').first()).toBeVisible();
    await expectDecodedLogo(page);
  });

  test('@smoke marketplace renders', async ({ page }) => {
    await page.goto('/marketplace');
    await expect(page.getByPlaceholder(/search materials/i)).toBeVisible();
  });

  test('@smoke login renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('@smoke register renders', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('@smoke brand images and PWA manifest are valid', async ({ request }) => {
    for (const path of [
      '/trace-wordmark.png',
      '/trace-logo.png',
      '/trace-logo-white.png',
      '/icon-192.png',
      '/icon-512.png',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toMatch(/^image\/png/);
      expect((await response.body()).subarray(0, 8), path).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
    const response = await request.get('/manifest.json');
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.name).toMatch(/TRACE/i);
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png' }),
        expect.objectContaining({ src: '/icon-512.png' }),
      ]),
    );
  });

  test('@smoke mobile home logo decodes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expectDecodedLogo(page);
  });

  test.describe('authenticated', () => {
    test.use({ storageState: statePath('supplier') });

    test('supplier dashboard loads (auth + API via domain)', async ({ page }) => {
      await page.goto('/passports');
      await expectDecodedLogo(page);
      await expect(page).toHaveURL(/\/passports/);
      await expect(
        page.getByRole('navigation').first().getByRole('link', { name: 'Passports' }),
      ).toBeVisible();
    });
  });
});
