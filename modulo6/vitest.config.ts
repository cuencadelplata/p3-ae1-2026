import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: [
      'tests/**/*.test.ts',
    ],
    exclude: ['tests-e2e/**'],
  },
});