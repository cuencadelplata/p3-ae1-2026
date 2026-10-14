const { defineConfig, devices } = require("@playwright/test");

// Corre los E2E de todo M3 contra el stack de docker-compose ya levantado.
// No arranca ningún servidor: si algo no responde, el test falla.
module.exports = defineConfig({
  timeout: 30 * 1000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "vehiculos",
      testDir: "./m3-vehiculos/tests/e2e",
      use: { baseURL: process.env.VEHICULOS_URL || "http://localhost:8083" },
    },
    {
      name: "conductor-api",
      testDir: "./M3-Conductor/tests/e2e",
      testMatch: "api.spec.js",
      use: { baseURL: process.env.CONDUCTOR_URL || "http://localhost:5000" },
    },
    {
      name: "conductor-frontend",
      testDir: "./M3-Conductor/tests/e2e",
      testMatch: "frontend.spec.js",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.FRONTEND_URL || "http://localhost:4000",
      },
    },
  ],
});
