import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.test.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3055',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx ts-node src/index.ts',
    port: 3055,
    timeout: 15_000,
    reuseExistingServer: false,
    env: {
      PORT: '3055',
    },
  },
});
