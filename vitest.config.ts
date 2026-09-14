import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules",
      "M7-cargo-cancelacion",
      "M6-trips-stub",
      "M7-historial-financiero",
      "dist",
      "src/test/E2E",
      "tests",
    ],
  },
});