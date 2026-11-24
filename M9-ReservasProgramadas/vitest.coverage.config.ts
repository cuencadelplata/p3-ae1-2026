import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts', 'tests/infrastructure/**/*.spec.ts'],
      exclude: ['tests/e2e/**'],
      testTimeout: 15000,
      hookTimeout: 15000,
    },
  }),
);
