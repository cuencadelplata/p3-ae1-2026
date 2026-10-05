/*
 * RF-8.2 — Pruebas de integración del almacenamiento QR en Redis.
 * Corren contra un Redis real: el contrato común de QrStore más TTL, vencimiento,
 * contenido de las claves y recuperación de los scripts Lua.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateQrDataUrl, generateQrToken } from "../../src/qr-generator";
import { qrRedisScripts } from "../../src/qr.redis-scripts";
import { createRedisQrStore } from "../../src/qr.redis-store";
import { createQrService } from "../../src/qr.service";
import type { QrRecord } from "../../src/qr.types";
import type { QrRedisClient } from "../../src/redis-client";
import { describeQrStoreContract } from "../contracts/qr-store.contract";
import { connectTestRedisClient, deleteKeysWithPrefix, redisNowMs, uniqueTestKeyPrefix } from "../helpers/redis";

const TRIP_ID = "trip-demo-001";
const TTL_SECONDS = 300;
const GRACE_SECONDS = 3600;
const POLL_INTERVAL_MS = 25;
const POLL_DEADLINE_MS = 3000;

const keyPrefix = uniqueTestKeyPrefix();
let client: QrRedisClient;

beforeAll(async () => {
  client = await connectTestRedisClient();
});

afterAll(async () => {
  if (client?.isOpen) {
    await deleteKeysWithPrefix(client, keyPrefix);
    await client.close();
  }
});

function createStore(expiredGraceSeconds = GRACE_SECONDS) {
  return createRedisQrStore({ client, keyPrefix, expiredGraceSeconds });
}

function createRecord(nowMs: number, overrides: Partial<QrRecord> = {}): QrRecord {
  return {
    id: randomUUID(),
    tripId: TRIP_ID,
    tokenHash: randomBytes(32).toString("hex"),
    createdAt: new Date(nowMs),
    expiresAt: new Date(nowMs + TTL_SECONDS * 1000),
    usedAt: null,
    ...overrides,
  };
}

async function waitUntilKeyIsGone(key: string): Promise<boolean> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    if ((await client.exists(key)) === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

describeQrStoreContract("createRedisQrStore", () => createStore(), async () => new Date(await redisNowMs(client)));

describe("createRedisQrStore — TTL y vencimiento en Redis", () => {
  it("tras save la clave tiene un TTL positivo y no mayor que ttl + margen", async () => {
    const store = createStore();
    const record = createRecord(await redisNowMs(client));

    await store.save(record);

    const pttl = await client.pTTL(`${keyPrefix}${record.tokenHash}`);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual((TTL_SECONDS + GRACE_SECONDS) * 1000);
  });

  it("con un margen mínimo, Redis borra la clave al vencer y la validación responde NOT_FOUND", async () => {
    const store = createStore(0.05);
    const nowMs = await redisNowMs(client);
    const record = createRecord(nowMs, { expiresAt: new Date(nowMs + 50) });
    const key = `${keyPrefix}${record.tokenHash}`;

    await store.save(record);
    expect(await client.exists(key)).toBe(1);

    expect(await waitUntilKeyIsGone(key)).toBe(true);
    expect(await store.consumeIfValid(record.tokenHash, TRIP_ID, new Date())).toBe("NOT_FOUND");
  });

  it("un QR vencido dentro del margen responde EXPIRED y su clave se conserva con TTL", async () => {
    const store = createStore();
    const nowMs = await redisNowMs(client);
    const record = createRecord(nowMs, { expiresAt: new Date(nowMs - 1000) });
    const key = `${keyPrefix}${record.tokenHash}`;

    await store.save(record);

    expect(await store.consumeIfValid(record.tokenHash, TRIP_ID, new Date())).toBe("EXPIRED");
    expect(await client.hExists(key, "usedAt")).toBe(0);
    const pttl = await client.pTTL(key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(GRACE_SECONDS * 1000);
  });

  it("save nunca deja una clave sin TTL, tampoco al reemplazar un registro ni al consumirlo", async () => {
    const store = createStore();
    const nowMs = await redisNowMs(client);
    const records = [
      createRecord(nowMs),
      createRecord(nowMs, { expiresAt: new Date(nowMs - 60_000) }),
      createRecord(nowMs, { usedAt: new Date(nowMs - 1000) }),
    ];

    for (const record of records) {
      await store.save(record);
      expect(await client.pTTL(`${keyPrefix}${record.tokenHash}`)).toBeGreaterThan(0);
    }

    const [first] = records;
    const key = `${keyPrefix}${first.tokenHash}`;
    await client.persist(key);
    await store.save(first);
    expect(await client.pTTL(key)).toBeGreaterThan(0);

    expect(await store.consumeIfValid(first.tokenHash, TRIP_ID, new Date())).toBe("OK");
    expect(await client.pTTL(key)).toBeGreaterThan(0);
  });
});

describe("createRedisQrStore — consumo", () => {
  it("TRIP_MISMATCH no consume el QR: luego se valida con el tripId correcto", async () => {
    const store = createStore();
    const record = createRecord(await redisNowMs(client));
    const key = `${keyPrefix}${record.tokenHash}`;
    await store.save(record);

    expect(await store.consumeIfValid(record.tokenHash, "otro-trip", new Date())).toBe("TRIP_MISMATCH");
    expect(await client.hExists(key, "usedAt")).toBe(0);

    expect(await store.consumeIfValid(record.tokenHash, TRIP_ID, new Date())).toBe("OK");
  });

  it("marca usedAt con la hora de Redis, no con el parámetro now", async () => {
    const store = createStore();
    const before = await redisNowMs(client);
    const record = createRecord(before);
    await store.save(record);

    expect(await store.consumeIfValid(record.tokenHash, TRIP_ID, new Date(0))).toBe("OK");

    const usedAt = Number(await client.hGet(`${keyPrefix}${record.tokenHash}`, "usedAt"));
    expect(usedAt).toBeGreaterThanOrEqual(before);
    expect(usedAt).toBeLessThanOrEqual((await redisNowMs(client)) + 1);
  });

  it("se recupera después de SCRIPT FLUSH: vuelve a cargar los scripts con EVAL", async () => {
    const store = createStore();
    const record = createRecord(await redisNowMs(client));

    await client.scriptFlush();
    const loaded = await client.scriptExists([
      qrRedisScripts.qrSave.SHA1,
      qrRedisScripts.qrGetOrCreate.SHA1,
      qrRedisScripts.qrConsume.SHA1,
    ]);
    expect(loaded.map(Number)).toEqual([0, 0, 0]);

    await store.save(record);
    expect(await store.consumeIfValid(record.tokenHash, TRIP_ID, new Date())).toBe("OK");
  });
});

describe("createRedisQrStore — contenido de Redis", () => {
  it("las claves no contienen el token y el hash conserva sólo los campos operativos necesarios", async () => {
    const store = createStore();
    const service = createQrService({
      store,
      config: { ttlSeconds: TTL_SECONDS },
      generateQrToken,
      generateQrDataUrl,
      now: () => new Date(),
      log: () => {},
    });

    const tripId = `${TRIP_ID}-contenido`;
    const { token } = await service.generateQr(tripId);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const key = `${keyPrefix}${tokenHash}`;

    const keysBefore = await collectKeys();
    expect(keysBefore).toContain(key);
    for (const candidate of keysBefore) {
      expect(candidate).not.toContain(token);
    }

    const stored = await client.hGetAll(key);
    expect(Object.keys(stored).sort()).toEqual(["createdAt", "expiresAt", "id", "token", "tripId"]);
    expect(stored.tripId).toBe(tripId);
    expect(stored.token).toBe(token);
    for (const value of Object.values(stored).filter((value) => value !== stored.token)) {
      expect(value).not.toContain(token);
    }

    await service.validateQr(tripId, token);

    const consumed = await client.hGetAll(key);
    expect(Object.keys(consumed).sort()).toEqual(["createdAt", "expiresAt", "id", "token", "tripId", "usedAt"]);
    expect(consumed.token).toBe(token);
    for (const value of Object.values(consumed).filter((value) => value !== consumed.token)) {
      expect(value).not.toContain(token);
    }
  });
});

async function collectKeys(): Promise<string[]> {
  const keys: string[] = [];
  for await (const batch of client.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 100 })) {
    keys.push(...([] as string[]).concat(batch));
  }
  return keys;
}
