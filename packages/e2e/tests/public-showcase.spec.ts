import { test, expect } from '@playwright/test';

test.describe('@showcase public read-only experience', () => {
  test.skip(process.env.E2E_SHOWCASE !== '1', 'requires the public_showcase profile');
  test('home identifies the showcase and hides account actions', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(/Public research showcase/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^sign in$/i })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /get started/i })).not.toBeVisible();
  });

  test('curated marketplace and passport remain explorable', async ({ page }) => {
    await page.goto('/marketplace');

    await expect(page.getByPlaceholder(/search materials/i)).toBeVisible();
    const product = page.getByText('Reclaimed Aluminium Stud Walling').first();
    await expect(product).toBeVisible();
    await product.click();

    await expect(page).toHaveURL(/\/marketplace\//);
    await expect(page.getByText('Reclaimed Aluminium Stud Walling').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /make offer/i })).not.toBeVisible();

    const passportLink = page.getByRole('link', { name: /passport/i }).first();
    await expect(passportLink).toBeVisible();
    await passportLink.click();
    await expect(page).toHaveURL(/\/passport\//);
    await expect(page.getByText(/Trust layer prepared|Blockchain verified/i).first()).toBeVisible();
  });

  test('login and registration fail closed in the interface', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/Sign-in is disabled here/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).not.toBeVisible();

    await page.goto('/register');
    await expect(page.getByText(/Account creation is disabled here/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).not.toBeVisible();
  });

  test('marketplace has no horizontal overflow at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/marketplace');
    await expect(page.getByPlaceholder(/search materials/i)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
