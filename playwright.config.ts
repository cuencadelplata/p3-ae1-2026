import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 10000,

  use: {
    baseURL: "http://localhost:3000",
  },

  reporter: "list",

  projects: [
    {
      name: "historial-financiero",
      testDir: "./tests",
    },
    {
      name: "m7-tarifas",
      testDir: "./src/test/E2E",
    },
  ],
});
