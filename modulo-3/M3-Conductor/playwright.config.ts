import { defineConfig, devices } from '@playwright/test';

/**
 * Unit tests: Node.js puro (sin browser).
 * E2E: Chromium contra el frontend/API.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'unit',
      testDir: './tests',
      testMatch: /.*\.test\.js/,
      testIgnore: [/helpers/],
    },
    {
      name: 'e2e',
      testDir: './e2e',
      use: {
        ...devices['Desktop Chrome'],
        trace: 'on-first-retry',
      },
    },
  ],
});
