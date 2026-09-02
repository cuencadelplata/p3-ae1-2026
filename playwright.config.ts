import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/ui",
  testMatch: "**/*.ui.e2e.test.ts",
  globalSetup: "./tests/e2e/support/playwright-global-setup.ts",
  timeout: 30_000,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
  },
});
