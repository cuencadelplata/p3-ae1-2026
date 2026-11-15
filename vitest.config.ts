import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
      CARGO_CANCELACION_URL: "http://localhost:3007",
    },
    exclude: [
      "node_modules",
      "dist",
      "src/test/E2E",
      "tests",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/index.ts",
        "src/infraestructura/**",
        "src/mock/**",
        "src/**/I*.ts",
      ],
    },
  },
});