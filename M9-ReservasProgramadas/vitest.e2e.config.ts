import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
