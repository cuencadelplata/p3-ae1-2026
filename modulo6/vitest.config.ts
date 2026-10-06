import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: [
      'rf-6.1-6.2-6.3/tests/**/*.test.ts',
      'rf-6.4-6.7/tests/**/*.test.ts',
      'rf-6.5-6.6/tests/**/*.test.ts',
    ],
    exclude: ['**/tests/e2e/**', '**/tests-e2e/**'],
  },
});