import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const localEnvPath = resolve(__dirname, "../..", ".env");
if (!existsSync(localEnvPath)) {
  throw new Error("Falta modulo-8/.env para las pruebas de integración.");
}

loadEnvFile(localEnvPath);

if (process.env.NOTIFICATIONS_TEST_DATABASE_URL === undefined) {
  const password = process.env.NOTIFICATIONS_DB_PASSWORD;
  if (!password || password.startsWith("replace-with-")) {
    throw new Error("Configurar NOTIFICATIONS_DB_PASSWORD en modulo-8/.env.");
  }
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
