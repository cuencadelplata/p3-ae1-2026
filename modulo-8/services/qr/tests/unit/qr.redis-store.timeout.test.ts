/*
 * RF-8.2 — Pruebas unitarias del tope de tiempo de las operaciones del store en Redis.
 * Con reloj simulado y un cliente falso cuya respuesta no llega o llega tarde.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRedisQrStore, DEFAULT_OPERATION_TIMEOUT_MS, QrStoreTimeoutError } from "../../src/qr.redis-store";
import { QrStoreUnavailableError } from "../../src/qr.store";
import type { QrOperationalRecord } from "../../src/qr.store";
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

type FakeClient = Partial<Record<"qrSave" | "qrGetOrCreate" | "qrConsume", () => Promise<unknown>>>;

function storeWith(client: FakeClient, operationTimeoutMs?: number) {
  return createRedisQrStore({
    client: client as unknown as QrRedisClient,
    expiredGraceSeconds: 3600,
    operationTimeoutMs,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// Convierte el rechazo esperado en valor, para inspeccionarlo sin dejarlo sin manejar.
function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("se esperaba un rechazo");
    },
    (error: unknown) => error,
  );
}

describe("createRedisQrStore — tope de tiempo de las operaciones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["save", (store: ReturnType<typeof storeWith>) => store.save(RECORD)],
    ["get-or-create", (store: ReturnType<typeof storeWith>) => store.getOrCreateActive(RECORD, new Date())],
    ["consume", (store: ReturnType<typeof storeWith>) => store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date())],
  ] as const)("%s sin respuesta: al vencer el tope por defecto rechaza con resultado indeterminado", async (operation, run) => {
    const never = () => new Promise<never>(() => {});
    let settled = false;
    const result = rejectionOf(run(storeWith({ qrSave: never, qrGetOrCreate: never, qrConsume: never }))).then((error) => {
      settled = true;
      return error;
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_OPERATION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = (await result) as QrStoreUnavailableError;
    expect(error).toBeInstanceOf(QrStoreUnavailableError);
    expect(error.operation).toBe(operation);
    expect(error.outcomeUnknown).toBe(true);
    expect(error.cause).toBeInstanceOf(QrStoreTimeoutError);
    expect(error.causeName).toBe("QrStoreTimeoutError");
  });

  it("respeta un tope configurado", async () => {
    const store = storeWith({ qrConsume: () => new Promise<never>(() => {}) }, 300);

    const result = rejectionOf(store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date()));
    await vi.advanceTimersByTimeAsync(300);

    expect(((await result) as QrStoreUnavailableError).causeName).toBe("QrStoreTimeoutError");
  });

  it("una respuesta antes del tope se devuelve normalmente", async () => {
    const reply = deferred<string>();
    const store = storeWith({ qrConsume: () => reply.promise }, 300);

    const result = store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date());
    await vi.advanceTimersByTimeAsync(299);
    reply.resolve("OK");

    await expect(result).resolves.toBe("OK");
  });

  it("un rechazo tardío, después del tope, no queda sin manejar", async () => {
    const reply = deferred<string>();
    const store = storeWith({ qrConsume: () => reply.promise }, 300);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      const result = rejectionOf(store.consumeIfValid(RECORD.tokenHash, RECORD.tripId, new Date()));
      await vi.advanceTimersByTimeAsync(300);
      await result;

      reply.reject(new Error("la conexión se cortó después del tope"));
      // Node informa los rechazos sin manejar al terminar la tarea en curso: se espera una
      // vuelta real del event loop.
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
});
