import { defineConfig } from 'vitest/config';

// Tests unitarios: no necesitan Docker ni servicios externos.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
