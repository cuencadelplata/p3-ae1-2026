/*
 * RF-8.2 — Pruebas de integración de GET /health/live, /health/ready y /health.
 * Verifican códigos y cuerpos del contrato con la comprobación de Redis simulada y, al
 * final, con un Redis real.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createInMemoryQrStore } from "../../src/qr.store";
import { createQrRedisClient, isRedisReady, type QrRedisClient } from "../../src/redis-client";
import { buildApp } from "../helpers/build-app";
import { connectTestRedisClient } from "../helpers/redis";

const READY_BODY = { status: "ok", service: "qr", dependencies: { redis: { status: "available" } } };
const NOT_READY_BODY = { status: "unavailable", service: "qr", dependencies: { redis: { status: "unavailable" } } };

function appWithRedisCheck(checkRedis: () => Promise<boolean>) {
  return buildApp(createInMemoryQrStore(), checkRedis);
}

describe("GET /health/live", () => {
  it("responde 200 sin consultar Redis, aunque Redis no esté disponible", async () => {
    const checkRedis = vi.fn(async () => false);

    const response = await request(appWithRedisCheck(checkRedis)).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "qr" });
    expect(checkRedis).not.toHaveBeenCalled();
  });
});

describe.each(["/health/ready", "/health"])("GET %s", (path) => {
  it("responde 200 con Redis disponible", async () => {
    const response = await request(appWithRedisCheck(async () => true)).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(READY_BODY);
  });

  it("responde 503 con Redis no disponible", async () => {
    const response = await request(appWithRedisCheck(async () => false)).get(path);

    expect(response.status).toBe(503);
    expect(response.body).toEqual(NOT_READY_BODY);
  });

  it("responde 503 cuando la comprobación de Redis rechaza, sin exponer el error", async () => {
    const response = await request(
      appWithRedisCheck(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:6379");
      }),
    ).get(path);

    expect(response.status).toBe(503);
    expect(response.body).toEqual(NOT_READY_BODY);
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });
});

describe("health con Redis real", () => {
  let client: QrRedisClient;

  beforeAll(async () => {
    client = await connectTestRedisClient();
  });

  afterAll(async () => {
    if (client?.isOpen) {
      await client.close();
    }
  });

  it("isRedisReady responde true con un cliente conectado", async () => {
    await expect(isRedisReady(client)).resolves.toBe(true);
  });

  it("isRedisReady responde false sin conexión, sin enviar comandos", async () => {
    const disconnected = createQrRedisClient({ url: "redis://localhost:6390", log: () => {} });

    await expect(isRedisReady(disconnected)).resolves.toBe(false);
  });

  it("GET /health/ready responde 200 con la comprobación real", async () => {
    const response = await request(appWithRedisCheck(() => isRedisReady(client))).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(READY_BODY);
  });
});
