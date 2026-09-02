import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Directorio donde están los tests e2e
  testDir: './tests/e2e',

  // Timeout por test
  timeout: 30_000,

  // Reintentos en CI
  retries: process.env.CI ? 2 : 0,

  // Reporters
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    // La UI corre en el contenedor client (puerto 5173)
    baseURL: process.env.BASE_URL || 'http://localhost:5173',

    // Captura de pantalla y trazas solo en fallo
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
