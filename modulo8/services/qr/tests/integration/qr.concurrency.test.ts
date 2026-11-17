/*
 * RF-8.2 — Concurrencia, consistencia y uso único del QR con Redis real.
 *
 * La carrera principal de validación ocurre cuando varias solicitudes intentan consumir el
 * mismo QR al mismo tiempo. Si la comprobación de "no usado" y la marca de uso son pasos
 * separados, más de una validación puede aprobarse.
 *
 * Además, POST /qr es get-or-create para un viaje: mientras exista un QR activo, no consumido
 * y no vencido, los reintentos devuelven el mismo token y el mismo vencimiento. Esto evita que
 * una repetición de la solicitud genere varios QR operativos para el mismo viaje.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRedisQrStore } from "../../src/qr.redis-store";
import type { QrStore } from "../../src/qr.store";
import type { QrRedisClient } from "../../src/redis-client";
import { buildApp } from "../helpers/build-app";
import { createBarrier, createNaiveRedisQrStore } from "../helpers/naive-store";
import { connectTestRedisClient, deleteKeysWithPrefix, redisNowMs, uniqueTestKeyPrefix } from "../helpers/redis";

const TRIP_ID = "trip-demo-001";
const OTHER_TRIP_ID = "otro-viaje";
const ALREADY_USED_BODY = { error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." } };

const keyPrefix = uniqueTestKeyPrefix();
let clientA: QrRedisClient;
let clientB: QrRedisClient;

beforeAll(async () => {
  clientA = await connectTestRedisClient();
  clientB = await connectTestRedisClient();
});

afterAll(async () => {
  if (clientA?.isOpen) {
    await deleteKeysWithPrefix(clientA, keyPrefix);
    await clientA.close();
  }
  if (clientB?.isOpen) {
    await clientB.close();
  }
});

function redisStore(client: QrRedisClient): QrStore {
  return createRedisQrStore({ client, keyPrefix, expiredGraceSeconds: 3600 });
}

async function generateToken(app: Express, tripId = TRIP_ID): Promise<string> {
  const response = await request(app).post("/qr").send({ tripId });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

function validateConcurrently(apps: readonly Express[], count: number, token: string, tripIdFor = (_i: number) => TRIP_ID) {
  return Promise.all(
    Array.from({ length: count }, (_unused, i) =>
      request(apps[i % apps.length]).post("/qr/validate").send({ tripId: tripIdFor(i), token }),
    ),
  );
}

function statusCounts(responses: readonly request.Response[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const { status } of responses) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

describe("1. el problema: consumo no atómico (leer y después escribir)", () => {
  it("con N=10 validaciones simultáneas, más de una (todas) devuelve 200", async () => {
    const count = 10;
    const app = buildApp({
      store: createNaiveRedisQrStore({ client: clientA, keyPrefix, betweenReadAndWrite: createBarrier(count) }),
    });
    const token = await generateToken(app);

    const responses = await validateConcurrently([app], count, token);

    const approved = responses.filter((response) => response.status === 200).length;
    expect(approved).toBeGreaterThan(1);
    expect(approved).toBe(count);
  });
});

describe("2. la solución: consumo atómico con un script Lua en Redis", () => {
  it.each([10, 20, 100])("con N=%i validaciones simultáneas, exactamente una 200 y el resto 409", async (count) => {
    const app = buildApp({ store: redisStore(clientA) });
    const token = await generateToken(app);

    const responses = await validateConcurrently([app], count, token);

    expect(statusCounts(responses)).toEqual({ 200: 1, 409: count - 1 });
    for (const response of responses.filter(({ status }) => status === 409)) {
      expect(response.body).toEqual(ALREADY_USED_BODY);
    }
  });
});

describe("3. dos instancias del servicio contra el mismo Redis", () => {
  it("generar en A y validar 20 veces alternando A y B: exactamente una 200 y el resto 409", async () => {
    const appA = buildApp({ store: redisStore(clientA) });
    const appB = buildApp({ store: redisStore(clientB) });
    const token = await generateToken(appA);

    const responses = await validateConcurrently([appA, appB], 20, token);

    expect(statusCounts(responses)).toEqual({ 200: 1, 409: 19 });
  });
});

describe("4. contraste con AE1: store en memoria con dos instancias", () => {
  it("generar en A y validar en B responde 404; en A, 200", async () => {
    const appA = buildApp();
    const appB = buildApp();
    const token = await generateToken(appA);

    const inB = await request(appB).post("/qr/validate").send({ tripId: TRIP_ID, token });
    const inA = await request(appA).post("/qr/validate").send({ tripId: TRIP_ID, token });

    expect(inB.status).toBe(404);
    expect(inA.status).toBe(200);
  });
});

describe("5. vencimiento concurrente", () => {
  it("10 validaciones simultáneas de un QR vencido: todas 410, ninguna 200", async () => {
    const store = redisStore(clientA);
    const token = randomBytes(32).toString("base64url");
    const nowMs = await redisNowMs(clientA);
    await store.save({
      id: randomUUID(),
      tripId: TRIP_ID,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      createdAt: new Date(nowMs - 301_000),
      expiresAt: new Date(nowMs - 1000),
      usedAt: null,
    });

    const responses = await validateConcurrently([buildApp({ store })], 10, token);

    expect(statusCounts(responses)).toEqual({ 410: 10 });
  });
});

describe("6. validaciones simultáneas con viajes mezclados", () => {
  it("20 validaciones mezcladas: las del otro viaje 404; las del viaje correcto, una 200 y el resto 409", async () => {
    const app = buildApp({ store: redisStore(clientA) });
    const token = await generateToken(app);
    const tripIdFor = (i: number) => (i % 2 === 0 ? TRIP_ID : OTHER_TRIP_ID);

    const responses = await validateConcurrently([app], 20, token, tripIdFor);

    const otherTrip = responses.filter((_response, i) => tripIdFor(i) === OTHER_TRIP_ID);
    const rightTrip = responses.filter((_response, i) => tripIdFor(i) === TRIP_ID);
    expect(statusCounts(otherTrip)).toEqual({ 404: 10 });
    expect(statusCounts(rightTrip)).toEqual({ 200: 1, 409: 9 });
  });

  it("un intento con otro viaje no consume: después la validación legítima responde 200", async () => {
    const app = buildApp({ store: redisStore(clientA) });
    const token = await generateToken(app);

    const wrong = await request(app).post("/qr/validate").send({ tripId: OTHER_TRIP_ID, token });
    const right = await request(app).post("/qr/validate").send({ tripId: TRIP_ID, token });

    expect(wrong.status).toBe(404);
    expect(right.status).toBe(200);
  });
});

describe("7. generación idempotente para el mismo viaje", () => {
  it("20 POST /qr simultáneos para el mismo tripId devuelven el mismo token y el mismo vencimiento", async () => {
    const app = buildApp({ store: redisStore(clientA) });

    const generated = await Promise.all(
      Array.from({ length: 20 }, () => request(app).post("/qr").send({ tripId: TRIP_ID })),
    );

    expect(statusCounts(generated)).toEqual({ 201: 20 });
    const tokens = generated.map((response) => response.body.token as string);
    const expiresAt = generated.map((response) => response.body.expiresAt as string);
    const qrDataUrls = generated.map((response) => response.body.qrDataUrl as string);

    expect(new Set(tokens).size).toBe(1);
    expect(new Set(expiresAt).size).toBe(1);
    expect(new Set(qrDataUrls).size).toBe(1);
  });

  it("un reintento posterior no renueva el TTL: conserva expiresAt", async () => {
    const app = buildApp({ store: redisStore(clientA) });

    const first = await request(app).post("/qr").send({ tripId: `${TRIP_ID}-ttl` });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const retry = await request(app).post("/qr").send({ tripId: `${TRIP_ID}-ttl` });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.token).toBe(first.body.token);
    expect(retry.body.expiresAt).toBe(first.body.expiresAt);
  });

  it("viajes distintos reciben tokens distintos", async () => {
    const app = buildApp({ store: redisStore(clientA) });

    const first = await request(app).post("/qr").send({ tripId: `${TRIP_ID}-a` });
    const second = await request(app).post("/qr").send({ tripId: `${TRIP_ID}-b` });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
  });

  it("después de consumir el QR, un nuevo POST /qr crea otro token", async () => {
    const app = buildApp({ store: redisStore(clientA) });
    const tripId = `${TRIP_ID}-consumed`;

    const first = await request(app).post("/qr").send({ tripId });
    const validation = await request(app).post("/qr/validate").send({ tripId, token: first.body.token });
    const second = await request(app).post("/qr").send({ tripId });

    expect(validation.status).toBe(200);
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
  });

  it("crear un nuevo QR después de consumir el anterior no elimina el 409 del token usado", async () => {
    const app = buildApp({ store: redisStore(clientA) });
    const tripId = `${TRIP_ID}-used-evidence`;

    const first = await request(app).post("/qr").send({ tripId });
    const tokenA = first.body.token as string;
    const validation = await request(app).post("/qr/validate").send({ tripId, token: tokenA });
    const second = await request(app).post("/qr").send({ tripId });
    const tokenB = second.body.token as string;
    const oldTokenRetry = await request(app).post("/qr/validate").send({ tripId, token: tokenA });

    expect(first.status).toBe(201);
    expect(validation.status).toBe(200);
    expect(validation.body).toEqual({ valid: true });
    expect(second.status).toBe(201);
    expect(tokenB).not.toBe(tokenA);
    expect(oldTokenRetry.status).toBe(409);
    expect(oldTokenRetry.body).toEqual(ALREADY_USED_BODY);
  });

  it("después de vencer, un nuevo POST /qr crea otro token", async () => {
    const store = redisStore(clientA);
    const app = buildApp({ store });
    const tripId = `${TRIP_ID}-expired`;
    const oldToken = randomBytes(32).toString("base64url");
    const nowMs = await redisNowMs(clientA);
    await store.getOrCreateActive(
      {
        id: randomUUID(),
        tripId,
        tokenHash: createHash("sha256").update(oldToken).digest("hex"),
        token: oldToken,
        createdAt: new Date(nowMs - 301_000),
        expiresAt: new Date(nowMs - 1000),
        usedAt: null,
      },
      new Date(nowMs),
    );

    const second = await request(app).post("/qr").send({ tripId });

    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(oldToken);
  });
});
