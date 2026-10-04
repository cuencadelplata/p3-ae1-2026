import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
  },
  reporter: "list",
});
