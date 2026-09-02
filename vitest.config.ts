import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules",
      "M7-cargo-cancelacion",
      "dist",
      "src/test/E2E",   // Vitest no debe tocar esto, es de Playwright
    ],
  },
});