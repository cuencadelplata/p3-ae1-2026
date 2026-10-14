/*
 * RF-8.2 — Pruebas unitarias de la traducción de fallas de Redis en el store.
 * Con un cliente falso que lanza cada tipo de error: las fallas de Redis se convierten en
 * QrStoreUnavailableError y una respuesta inesperada de script sigue siendo un error propio.
 */
import {
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ErrorReply,
  SocketClosedUnexpectedlyError,
  TimeoutError,
} from "redis";
import { describe, expect, it, vi } from "vitest";

import { QrScriptReplyError } from "../../src/qr.redis-scripts";
import { createRedisQrStore } from "../../src/qr.redis-store";
import { QrStoreUnavailableError, type QrOperationalRecord } from "../../src/qr.store";
import type { QrRedisClient } from "../../src/redis-client";

const RECORD: QrOperationalRecord = {
  id: "qr-1",
  tripId: "trip-demo-001",
  tokenHash: "a".repeat(64),
  token: "token-opaco",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  expiresAt: new Date("2026-09-01T12:05:00.000Z"),
  usedAt: null,
};

function storeWithFailingClient(error: unknown) {
  const client = {
    qrSave: vi.fn(async () => {
      throw error;
    }),
    qrGetOrCreate: vi.fn(async () => {
      throw error;
    }),
    qrConsume: vi.fn(async () => {
      throw error;
    }),
  } as unknown as QrRedisClient;
  return createRedisQrStore({ client, expiredGraceSeconds: 3600 });
}

function econnrefused(): AggregateError {
  return Object.assign(new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:6379")], ""), {
    code: "ECONNREFUSED",
  });
}

// [descripción, error, ¿el resultado queda indeterminado?, nombre registrado]
const REDIS_FAILURES: ReadonlyArray<readonly [string, () => unknown, boolean, string]> = [
  ["ClientClosedError (cliente cerrado)", () => new ClientClosedError(), false, "ClientClosedError"],
  ["ClientOfflineError (sin conexión, sin cola)", () => new ClientOfflineError(), false, "ClientOfflineError"],
  ["ErrorReply LOADING", () => new ErrorReply("LOADING Redis is loading the dataset in memory"), false, "ErrorReply"],
  ["ErrorReply OOM", () => new ErrorReply("OOM command not allowed when used memory > 'maxmemory'"), false, "ErrorReply"],
  ["ErrorReply READONLY", () => new ErrorReply("READONLY You can't write against a read only replica."), false, "ErrorReply"],
  ["ErrorReply NOSCRIPT", () => new ErrorReply("NOSCRIPT No matching script."), false, "ErrorReply"],
  ["TimeoutError (comando sin respuesta a tiempo)", () => new TimeoutError(), true, "TimeoutError"],
  ["SocketClosedUnexpectedlyError (conexión cortada)", () => new SocketClosedUnexpectedlyError(), true, "SocketClosedUnexpectedlyError"],
  ["DisconnectsClientError", () => new DisconnectsClientError(), true, "DisconnectsClientError"],
  ["ConnectionTimeoutError", () => new ConnectionTimeoutError(), true, "ConnectionTimeoutError"],
  ["AggregateError ECONNREFUSED", econnrefused, true, "AggregateError"],
  ["Error desconocido del cliente", () => new Error("algo del cliente"), true, "Error"],
];

describe("createRedisQrStore — traducción de fallas de Redis", () => {
  describe.each([
    ["save", (store: ReturnType<typeof storeWithFailingClient>) => store.save(RECORD), "qrSave"],
    [
      "get-or-create",
      (store: ReturnType<typeof storeWithFailingClient>) => store.getOrCreateActive(RECORD, new Date()),
      "qrGetOrCreate",
    ],
    [
      "consume",
      (store: ReturnType<typeof storeWithFailingClient>) => store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date()),
      "qrConsume",
    ],
  ] as const)("operación %s", (operation, run, scriptName) => {
    it.each(REDIS_FAILURES)("%s se traduce a QrStoreUnavailableError", async (_label, makeError, outcomeUnknown, loggedName) => {
      const cause = makeError();

      const error = await run(storeWithFailingClient(cause)).then(
        () => {
          throw new Error("se esperaba un rechazo");
        },
        (rejection: unknown) => rejection,
      );

      expect(error).toBeInstanceOf(QrStoreUnavailableError);
      const unavailable = error as QrStoreUnavailableError;
      expect(unavailable.operation).toBe(operation);
      expect(unavailable.outcomeUnknown).toBe(outcomeUnknown);
      expect(unavailable.cause).toBe(cause);
      expect(unavailable.causeName).toBe(loggedName);
    });

    it("una respuesta inesperada de script NO se traduce: sigue siendo un error del servicio", async () => {
      const scriptError = new QrScriptReplyError(scriptName);

      await expect(run(storeWithFailingClient(scriptError))).rejects.toBe(scriptError);
    });
  });

  it("sin fallas, devuelve el resultado del script", async () => {
    const client = {
      qrSave: vi.fn(async () => undefined),
      qrGetOrCreate: vi.fn(async () => ({ record: RECORD, created: true })),
      qrConsume: vi.fn(async () => "ALREADY_USED"),
    } as unknown as QrRedisClient;
    const store = createRedisQrStore({ client, expiredGraceSeconds: 3600 });

    await expect(store.save(RECORD)).resolves.toBeUndefined();
    await expect(store.getOrCreateActive(RECORD, new Date())).resolves.toEqual({ record: RECORD, created: true });
    await expect(store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date())).resolves.toBe("ALREADY_USED");
  });
});
