import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    include: ["tests/integration-db/**/*.test.ts"],
    fileParallelism: false,
  },
});
