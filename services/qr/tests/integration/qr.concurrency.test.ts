/*
 * RF-8.2 — Concurrencia, consistencia y uso único del QR con Redis real.
 *
 * La carrera: varias validaciones simultáneas del mismo QR (por ejemplo, el conductor reintenta
 * mientras la primera solicitud sigue en curso, o dos instancias del servicio reciben el mismo
 * QR). Si la comprobación de "no usado" y la marca de uso son pasos separados, más de una
 * validación puede aprobarse y M6 podría iniciar el viaje dos veces.
 *
 * Estas pruebas demuestran la carrera con un store ingenuo, verifican que el store real (un
 * script Lua atómico en Redis) la evita, también entre dos instancias, y cubren los casos
 * límite de vencimiento, viaje incorrecto y generación simultánea. Todas las solicitudes pasan
 * por HTTP real (supertest) contra la aplicación completa.
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
  // Afirma el DEFECTO a propósito: es la contraparte del test 2. Con un store ingenuo que lee
  // usedAt y lo marca en un segundo comando, la barrera obliga a que las 10 lecturas ocurran
  // antes de la primera escritura; todas ven el QR sin usar y todas lo aprueban. Es la
  // duplicación que el store real tiene que impedir.
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
  // Mismo escenario que el test 1 con el store real: la comprobación y la marca de uso son un
  // único script que Redis ejecuta sin intercalar otros comandos. Sólo una validación gana.
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
  // Dos aplicaciones, cada una con su propio cliente Redis y su propio store, como dos
  // réplicas detrás de un balanceador. El QR se genera en A y las validaciones se reparten
  // entre A y B: el uso único se mantiene entre instancias.
  it("generar en A y validar 20 veces alternando A y B: exactamente una 200 y el resto 409", async () => {
    const appA = buildApp({ store: redisStore(clientA) });
    const appB = buildApp({ store: redisStore(clientB) });
    const token = await generateToken(appA);

    const responses = await validateConcurrently([appA, appB], 20, token);

    expect(statusCounts(responses)).toEqual({ 200: 1, 409: 19 });
  });
});

describe("4. contraste con AE1: store en memoria con dos instancias", () => {
  // Cada instancia tiene su propio Map: un QR generado en A no existe para B. Con réplicas,
  // el QR sería válido o no según qué instancia atienda la validación. Por eso el estado
  // pasa a Redis.
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
  // Un QR vencido (dentro del margen en que se informa 410) no se aprueba aunque lleguen
  // muchas validaciones a la vez: todas responden 410 y ninguna lo consume.
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
  // Las validaciones con otro tripId responden 404 y no consumen el QR; entre las del viaje
  // correcto, una sola gana. Un QR presentado para otro viaje no "quema" el QR legítimo.
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

  // Complemento secuencial: un intento con otro viaje antes de la validación legítima no la
  // impide.
  it("un intento con otro viaje no consume: después la validación legítima responde 200", async () => {
    const app = buildApp({ store: redisStore(clientA) });
    const token = await generateToken(app);

    const wrong = await request(app).post("/qr/validate").send({ tripId: OTHER_TRIP_ID, token });
    const right = await request(app).post("/qr/validate").send({ tripId: TRIP_ID, token });

    expect(wrong.status).toBe(404);
    expect(right.status).toBe(200);
  });
});

describe("7. caracterización: generación simultánea para el mismo viaje", () => {
  // Comportamiento ACTUAL, no un requisito: cada POST /qr crea un QR nuevo e independiente,
  // así que un viaje puede tener varios QR activos a la vez y cualquiera de ellos se puede
  // usar una vez. Queda documentado para decidir en el ADR si generar un QR nuevo debería
  // invalidar los anteriores del mismo viaje.
  it("10 POST /qr simultáneos para el mismo tripId devuelven 10 tokens distintos, todos válidos", async () => {
    const app = buildApp({ store: redisStore(clientA) });

    const generated = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/qr").send({ tripId: TRIP_ID })),
    );

    expect(statusCounts(generated)).toEqual({ 201: 10 });
    const tokens = generated.map((response) => response.body.token as string);
    expect(new Set(tokens).size).toBe(10);

    const validated = await Promise.all(
      tokens.map((token) => request(app).post("/qr/validate").send({ tripId: TRIP_ID, token })),
    );
    expect(statusCounts(validated)).toEqual({ 200: 10 });
  });
});
