import { defineConfig, devices } from '@playwright/test';

/**
 * E2E target:
 *   - E2E_BASE_URL : the web app origin (default local dev web server)
 *   - E2E_API_URL  : the API origin used by global-setup to mint sessions.
 *     For the deployed domain both are the same origin (nginx proxies /api/).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  snapshotDir: './__screenshots__',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // Functional journey specs + visual snapshots at desktop width.
      name: 'desktop-chromium',
      testIgnore: ['**/mobile/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 375px mobile: hamburger/overflow checks + visual snapshots.
      name: 'mobile-375',
      testMatch: ['**/mobile/**/*.spec.ts', '**/visual/**/*.spec.ts'],
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
