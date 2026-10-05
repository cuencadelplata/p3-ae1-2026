import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false, // los archivos comparten TripDB real, no pueden correr al mismo tiempo
  },
});