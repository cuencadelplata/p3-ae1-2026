import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/E2E",
  use: {
    baseURL: "http://localhost:3000",
  },
});