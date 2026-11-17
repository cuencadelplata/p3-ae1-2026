import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Reemplaza Redis por un mock en memoria para que los tests no necesiten un Redis real.
        setupFiles: ["tests/setup.ts"]
    }
});
