/*
 * RF-8.2 — Pruebas de integración con Redis no disponible.
 * Un cliente Redis real apunta a un puerto sin servidor: las operaciones de QR responden 503
 * QR_STORE_UNAVAILABLE con Retry-After, rápido y sin detalles internos, y el health refleja
 * la caída. Las pruebas de corte, demora y recuperación con proxy van aparte.
 */
import net from "node:net";

import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../../src/observability/logger";
import { createRedisQrStore } from "../../src/qr.redis-store";
import { createQrRedisClient, isRedisReady, type QrRedisClient } from "../../src/redis-client";
import { buildApp } from "../helpers/build-app";
import { captureLogs, type CapturedLogs } from "../helpers/capture-logs";

const STORE_UNAVAILABLE_BODY = {
  error: {
    code: "QR_STORE_UNAVAILABLE",
    message: "El servicio de QR no está disponible en este momento. Intente nuevamente más tarde.",
  },
};
const FAST_RESPONSE_MS = 500;
const TRIP_ID = "trip-demo-001";

// Un puerto que estuvo libre: se abre y se cierra un servidor efímero para obtenerlo.
async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe.each([
  // Como en server.ts: connect() en segundo plano, reintentando sin éxito.
  ["conectando sin éxito", true],
  // El cliente nunca abrió la conexión.
  ["sin conexión abierta", false],
] as const)("Redis no disponible (%s)", (_label, startConnecting) => {
  let client: QrRedisClient;
  let logs: CapturedLogs;

  beforeAll(async () => {
    client = createQrRedisClient({ url: `redis://127.0.0.1:${await unusedPort()}`, log: () => {} });
    if (startConnecting) {
      client.connect().catch(() => {});
    }
  });

  afterAll(() => {
    if (client.isOpen) {
      client.destroy();
    }
  });

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  function app() {
    return buildApp({
      store: createRedisQrStore({ client, expiredGraceSeconds: 3600 }),
      checkRedis: () => isRedisReady(client),
      log: createLogger("qr"),
    });
  }

  it.each([
    ["POST /qr", "/qr", { tripId: TRIP_ID }, "save"],
    ["POST /qr/validate", "/qr/validate", { tripId: TRIP_ID, token: "valor-opaco" }, "consume"],
  ] as const)("%s responde 503 con Retry-After, cuerpo exacto y correlationId, rápido", async (_name, path, body, operation) => {
    const startedAt = performance.now();
    const response = await request(app()).post(path).set("X-Correlation-Id", "corr-redis-caido").send(body);
    const elapsedMs = performance.now() - startedAt;

    expect(response.status).toBe(503);
    expect(response.body).toEqual(STORE_UNAVAILABLE_BODY);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.headers["x-correlation-id"]).toBe("corr-redis-caido");
    expect(elapsedMs).toBeLessThan(FAST_RESPONSE_MS);
    expect(response.text).not.toMatch(/stack|Error|ECONNREFUSED|127\.0\.0\.1/);

    const storeEvents = logs.entries().filter((entry) => entry.event === "qr.store_unavailable");
    expect(storeEvents).toEqual([
      expect.objectContaining({
        level: "warn",
        operation,
        tripId: TRIP_ID,
        errorName: expect.any(String),
        correlationId: "corr-redis-caido",
      }),
    ]);
    expect(storeEvents[0]).not.toHaveProperty("stack");
    expect(logs.entries().some((entry) => entry.message === "error del servicio al atender la solicitud")).toBe(false);
  });

  it("nunca aprueba un QR: ninguna de varias validaciones responde 200", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app()).post("/qr/validate").send({ tripId: TRIP_ID, token: "valor" })),
    );

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503, 503]);
  });

  it("GET /health/ready responde 503 y GET /health/live 200", async () => {
    const ready = await request(app()).get("/health/ready");
    const live = await request(app()).get("/health/live");

    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({
      status: "unavailable",
      service: "qr",
      dependencies: { redis: { status: "unavailable" } },
    });
    expect(live.status).toBe(200);
  });
});
