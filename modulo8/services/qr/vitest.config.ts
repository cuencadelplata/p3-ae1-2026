import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Los logs JSON del servicio sólo se muestran en las pruebas que fallan.
    silent: "passed-only",
  },
});
