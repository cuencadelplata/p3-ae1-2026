import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: [
      'rf-6.1-6.2-6.3/tests/e2e/**/*.test.ts',
      'rf-6.4-6.7/tests-e2e/**/*.test.ts',
      'rf-6.5-6.6/tests-e2e/**/*.test.ts',
    ],
    testTimeout: 180000,
  },
});