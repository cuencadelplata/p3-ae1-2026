import assert from "node:assert/strict";
import test from "node:test";

import { Pool } from "pg";
import { createClient } from "redis";

const postgresUrl = process.env.POSTGRES_E2E_URL ?? "postgres://m8_admin:m8_admin_local@localhost:5432/m8";
const redisUrl = process.env.REDIS_E2E_URL ?? "redis://localhost:6379";
const rabbitApiUrl = process.env.RABBITMQ_API_URL ?? "http://localhost:15672/api";
const rabbitAuthorization = `Basic ${Buffer.from(process.env.RABBITMQ_API_CREDENTIALS ?? "guest:guest").toString("base64")}`;

test("PostgreSQL compartido expone los esquemas logicos de M8", async () => {
  const pool = new Pool({ connectionString: postgresUrl });
  try {
    const result = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[]) ORDER BY schema_name",
      [["messaging", "notification_delivery", "notifications", "receipts", "support"]],
    );
    assert.deepEqual(result.rows.map((row) => row.schema_name), ["messaging", "notification_delivery", "notifications", "receipts", "support"]);
  } finally {
    await pool.end();
  }
});

test("Redis compartido responde y permanece disponible", async () => {
  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    assert.equal(await client.ping(), "PONG");
  } finally {
    await client.quit().catch(() => undefined);
  }
});

test("RabbitMQ compartido expone el exchange y DLX acordados", async () => {
  const response = await fetch(`${rabbitApiUrl}/exchanges/%2F`, {
    headers: { authorization: rabbitAuthorization },
  });
  assert.equal(response.status, 200);
  const exchanges = await response.json();
  const names = new Set(exchanges.map((exchange) => exchange.name));
  assert.ok(names.has("mobility.events"));
  assert.ok(names.has("mobility.events.dlx"));
});
