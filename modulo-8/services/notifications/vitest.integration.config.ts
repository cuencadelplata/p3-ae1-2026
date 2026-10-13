import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const envPath = resolve(__dirname, "../..", ".env");

if (!existsSync(envPath)) {
  throw new Error("Falta modulo-8/.env. Crear el archivo a partir de .env.example antes de ejecutar pruebas de integracion.");
}

loadEnvFile(envPath);

if (process.env.NOTIFICATIONS_TEST_DATABASE_URL === undefined) {
  const password = process.env.NOTIFICATIONS_DB_PASSWORD ?? "m8_notifications_local";
  const port = process.env.POSTGRES_HOST_PORT ?? "5432";
  const database = process.env.NOTIFICATIONS_TEST_DB_NAME ?? "m8_notifications_test";

  process.env.NOTIFICATIONS_TEST_DATABASE_URL =
    `postgres://m8_notifications:${encodeURIComponent(password)}@localhost:${port}/${database}`;
}

export default defineConfig({
  root: __dirname,
  test: {
    include: ["tests/integration-db/**/*.test.ts"],
    fileParallelism: false,
  },
});
