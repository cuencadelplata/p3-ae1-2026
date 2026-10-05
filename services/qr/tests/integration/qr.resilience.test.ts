/*
 * RF-8.2 — Resiliencia ante caída, demora y recuperación de Redis.
 *
 * Un proxy TCP se interpone entre el servicio y un Redis real y simula fallas: Redis caído
 * (conexión rechazada), Redis colgado (no responde), respuesta perdida (el comando se ejecuta
 * pero la respuesta no llega) y corte con un comando en vuelo. Cada prueba arma su propio
 * proxy, cliente y aplicación; la limpieza de claves usa un cliente directo al Redis real.
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Express } from "express";

import { createLogger } from "../../src/observability/logger";
import { createRedisQrStore } from "../../src/qr.redis-store";
import { createQrRedisClient, isRedisReady, type QrRedisClient } from "../../src/redis-client";
import { buildApp } from "../helpers/build-app";
import { captureLogs, type CapturedLogs } from "../helpers/capture-logs";
import { connectTestRedisClient, deleteKeysWithPrefix, TEST_REDIS_URL, uniqueTestKeyPrefix } from "../helpers/redis";
import { startTcpProxy, type TcpProxy } from "../helpers/tcp-proxy";
import { waitFor } from "../helpers/wait-for";

const TRIP_ID = "trip-demo-001";
// Topes chicos para que las pruebas sean rápidas; en producción son de 2 s.
const OPERATION_TIMEOUT_MS = 300;
const TIMEOUT_MARGIN_MS = 700;
const FAST_RESPONSE_MS = 500;
// La reconexión espera hasta 5 s entre intentos: el sondeo de recuperación tiene un tope mayor.
const RECOVERY_DEADLINE_MS = 15_000;
const STORE_UNAVAILABLE_BODY = {
  error: {
    code: "QR_STORE_UNAVAILABLE",
    message: "El servicio de QR no está disponible en este momento. Intente nuevamente más tarde.",
  },
};

const keyPrefix = uniqueTestKeyPrefix();
const redisTarget = new URL(TEST_REDIS_URL);
let directClient: QrRedisClient;

let proxy: TcpProxy;
let client: QrRedisClient;
let app: Express;
let logs: CapturedLogs;

beforeAll(async () => {
  directClient = await connectTestRedisClient();
});

afterAll(async () => {
  if (directClient?.isOpen) {
    await deleteKeysWithPrefix(directClient, keyPrefix);
    await directClient.close();
  }
});

beforeEach(async () => {
  proxy = await startTcpProxy({ host: redisTarget.hostname, port: Number(redisTarget.port || 6379) });
  client = createQrRedisClient({
    url: proxy.url,
    commandTimeoutMs: OPERATION_TIMEOUT_MS,
    connectTimeoutMs: OPERATION_TIMEOUT_MS,
    log: () => {},
  });
  await client.connect();
  app = buildApp({
    store: createRedisQrStore({
      client,
      keyPrefix,
      expiredGraceSeconds: 3600,
      operationTimeoutMs: OPERATION_TIMEOUT_MS,
    }),
    checkRedis: () => isRedisReady(client),
    log: createLogger("qr"),
  });
  logs = captureLogs();
});

afterEach(async () => {
  logs.restore();
  if (client.isOpen) {
    client.destroy();
  }
  await proxy.close();
});

async function generateToken(): Promise<string> {
  const response = await request(app).post("/qr").send({ tripId: TRIP_ID });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

function validate(token: string) {
  return request(app).post("/qr/validate").send({ tripId: TRIP_ID, token });
}

async function timed<T>(run: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
  const startedAt = performance.now();
  const result = await run();
  return { result, elapsedMs: performance.now() - startedAt };
}

function storeUnavailableEvents() {
  return logs.entries().filter((entry) => entry.event === "qr.store_unavailable");
}

async function waitUntilReady(): Promise<void> {
  await waitFor(async () => (await request(app).get("/health/ready")).status === 200, {
    timeoutMs: RECOVERY_DEADLINE_MS,
    intervalMs: 50,
    what: "que /health/ready vuelva a 200",
  });
}

describe("resiliencia del QR ante fallas de Redis", () => {
  // Línea base: con el proxy reenviando, el servicio funciona igual que contra Redis directo.
  it("1. open: generar y validar funcionan", async () => {
    const token = await generateToken();

    expect((await validate(token)).status).toBe(200);
  });

  // Redis caído: el servicio sigue vivo y responde 503 al instante, con el formato del
  // contrato y sin detalles internos; el health lo refleja y cada solicitud afectada deja una
  // única línea de log.
  it("2. closed: 503 rápido con Retry-After, health ready 503 y live 200", async () => {
    await proxy.setMode("closed");
    await waitFor(() => !client.isReady, { timeoutMs: 2000, what: "que el cliente detecte la caída" });

    const generated = await timed(() => request(app).post("/qr").send({ tripId: TRIP_ID }));
    const validated = await timed(() => validate("valor-opaco"));

    for (const { result, elapsedMs } of [generated, validated]) {
      expect(result.status).toBe(503);
      expect(result.body).toEqual(STORE_UNAVAILABLE_BODY);
      expect(result.headers["retry-after"]).toBe("5");
      expect(result.text).not.toMatch(/stack|Error|127\.0\.0\.1/);
      expect(elapsedMs).toBeLessThan(FAST_RESPONSE_MS);
    }
    expect((await request(app).get("/health/ready")).status).toBe(503);
    expect((await request(app).get("/health/live")).status).toBe(200);
    expect(storeUnavailableEvents().map(({ operation }) => operation)).toEqual(["save", "consume"]);
  });

  // Redis colgado: la validación no queda esperando indefinidamente; al vencer el tope
  // responde 503 y nunca aprueba el QR (fail-closed). Como el comando no llegó a Redis, el QR
  // sigue vigente: al recuperarse, la misma validación responde 200.
  it("3. blackhole: 503 dentro del tope, nunca 200, y el QR sigue vigente al volver", async () => {
    const token = await generateToken();
    await proxy.setMode("blackhole");

    const { result, elapsedMs } = await timed(() => validate(token));

    expect(result.status).toBe(503);
    expect(result.body).toEqual(STORE_UNAVAILABLE_BODY);
    expect(elapsedMs).toBeGreaterThanOrEqual(OPERATION_TIMEOUT_MS - 10);
    expect(elapsedMs).toBeLessThan(OPERATION_TIMEOUT_MS + TIMEOUT_MARGIN_MS);
    expect(storeUnavailableEvents()).toEqual([
      expect.objectContaining({ operation: "consume", errorName: "QrStoreTimeoutError", outcomeUnknown: true }),
    ]);

    await proxy.setMode("open");
    await waitUntilReady();
    expect((await validate(token)).status).toBe(200);
  });

  // Respuesta perdida: el comando llega a Redis y se ejecuta, pero la respuesta no vuelve.
  // El servicio responde 503 por el tope; sin embargo el QR YA quedó consumido, y al
  // recuperarse la misma validación responde 409. Es la ambigüedad que documenta el contrato:
  // un 409 posterior a un 503 no prueba que el QR se haya usado en otra validación.
  it("4. drop-responses: 503 por el tope, pero el QR quedó consumido y luego responde 409", async () => {
    const token = await generateToken();
    await proxy.setMode("drop-responses");

    const { result } = await timed(() => validate(token));

    expect(result.status).toBe(503);
    expect(storeUnavailableEvents()).toEqual([expect.objectContaining({ operation: "consume", outcomeUnknown: true })]);

    await proxy.setMode("open");
    await waitUntilReady();
    const retried = await validate(token);
    expect(retried.status).toBe(409);
    expect(retried.body).toEqual({ error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." } });
  });

  // Recuperación automática: tras una caída, el mismo proceso y el mismo cliente vuelven a
  // atender sin reinicio ni intervención, apenas Redis está disponible de nuevo.
  it("5. tras closed y vuelta a open se recupera solo, sin reiniciar la app ni el cliente", async () => {
    const sameClient = client;
    await proxy.setMode("closed");
    await waitFor(() => !client.isReady, { timeoutMs: 2000, what: "que el cliente detecte la caída" });
    expect((await request(app).post("/qr").send({ tripId: TRIP_ID })).status).toBe(503);

    await proxy.setMode("open");
    await waitUntilReady();

    expect(client).toBe(sameClient);
    const token = await generateToken();
    expect((await validate(token)).status).toBe(200);
  });

  // Corte con un comando en vuelo: la validación ya fue enviada (y Redis no responde) cuando
  // la conexión se corta. La solicitud termina en 503 de inmediato, sin esperar el tope y sin
  // promesas rechazadas sin manejar; el resultado queda indeterminado.
  it("6. cortar la conexión con una validación pendiente responde 503 sin quedar colgado", async () => {
    const token = await generateToken();
    await proxy.setMode("blackhole");

    const startedAt = performance.now();
    const pending = validate(token).then((response) => response);
    await waitFor(() => proxy.clientBytesSinceModeChange > 0, {
      timeoutMs: 2000,
      intervalMs: 5,
      what: "que la validación llegue al proxy",
    });
    await proxy.setMode("closed");
    const response = await pending;
    const elapsedMs = performance.now() - startedAt;

    expect(response.status).toBe(503);
    expect(response.body).toEqual(STORE_UNAVAILABLE_BODY);
    expect(elapsedMs).toBeLessThan(OPERATION_TIMEOUT_MS);
    const [event] = storeUnavailableEvents();
    expect(event).toEqual(expect.objectContaining({ operation: "consume", outcomeUnknown: true }));
    expect(event.errorName).not.toBe("QrStoreTimeoutError");
  });
});
