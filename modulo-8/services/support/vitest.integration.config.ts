import { defineConfig } from 'vitest/config';

// Tests de integración: requieren el PostgreSQL de modulo-8 levantado
// (docker compose up -d postgres). Cada archivo trabaja en un schema efímero.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
