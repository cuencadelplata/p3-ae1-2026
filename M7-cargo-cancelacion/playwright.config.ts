import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/dist/**",
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3007",
  },
  reporter: "list",
});