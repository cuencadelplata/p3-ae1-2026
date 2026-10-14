import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const localEnvPath = resolve(__dirname, "../..", ".env");
const exampleEnvPath = resolve(__dirname, "../..", ".env.example");
const envPath = existsSync(localEnvPath) ? localEnvPath : exampleEnvPath;

if (!existsSync(envPath)) {
  throw new Error("Falta modulo-8/.env y modulo-8/.env.example; no se pueden ejecutar pruebas de integracion.");
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
