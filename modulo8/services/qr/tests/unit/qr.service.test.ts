/*
 * RF-8.2 — Pruebas unitarias del servicio QR.
 * Verifican generación idempotente, validación, hash y traducción de errores sin HTTP.
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/http/api-error";
import { QrScriptReplyError } from "../../src/qr.redis-scripts";
import { createQrService, STORE_RETRY_AFTER_SECONDS, type QrServiceDeps } from "../../src/qr.service";
import {
  QrStoreUnavailableError,
  type ConsumeOutcome,
  type QrGetOrCreateResult,
  type QrOperationalRecord,
} from "../../src/qr.store";

const TRIP_ID = "trip-demo-001";
const NOW = new Date("2026-09-01T12:00:00.000Z");
const TTL_SECONDS = 300;
const TOKEN = "token-en-claro-de-prueba";
const TOKEN_HASH = "b".repeat(64);
const QR_DATA_URL = "data:image/png;base64,AAAA";

interface DepsOverrides {
  consumeOutcome?: ConsumeOutcome;
  getOrCreateResult?: QrGetOrCreateResult;
  generateQrDataUrl?: ReturnType<typeof vi.fn<(token: string) => Promise<string>>>;
}

function candidateRecord(): QrOperationalRecord {
  return {
    id: expect.any(String) as unknown as string,
    tripId: TRIP_ID,
    tokenHash: TOKEN_HASH,
    token: TOKEN,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + TTL_SECONDS * 1000),
    usedAt: null,
  };
}

function createDeps(overrides: DepsOverrides = {}) {
  const save = vi.fn<(record: unknown) => Promise<void>>().mockResolvedValue(undefined);
  const getOrCreateActive = vi
    .fn<(record: QrOperationalRecord, now: Date) => Promise<QrGetOrCreateResult>>()
    .mockImplementation(async (record) => overrides.getOrCreateResult ?? { record, created: true });
  const consumeIfValid = vi
    .fn<(tokenHash: string, tripId: string, now: Date) => Promise<ConsumeOutcome>>()
    .mockResolvedValue(overrides.consumeOutcome ?? "OK");
  const generateQrDataUrl =
    overrides.generateQrDataUrl ?? vi.fn<(token: string) => Promise<string>>().mockResolvedValue(QR_DATA_URL);

  const deps: QrServiceDeps = {
    store: { save, getOrCreateActive, consumeIfValid },
    config: { ttlSeconds: TTL_SECONDS },
    generateQrToken: () => ({ token: TOKEN, tokenHash: TOKEN_HASH }),
    generateQrDataUrl,
    now: () => NOW,
    log: vi.fn(),
  };

  return { deps, save, getOrCreateActive, consumeIfValid, generateQrDataUrl };
}

async function captureAsyncApiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Se esperaba que la función lance un ApiError.");
}

describe("createQrService — generateQr", () => {
  it("solicita al store el QR operativo con token, tokenHash y expiresAt = createdAt + ttlSeconds", async () => {
    const { deps, getOrCreateActive } = createDeps();
    const service = createQrService(deps);

    await service.generateQr(TRIP_ID);

    expect(getOrCreateActive).toHaveBeenCalledTimes(1);
    expect(getOrCreateActive.mock.calls[0][0]).toEqual(candidateRecord());
    expect(getOrCreateActive.mock.calls[0][1]).toBe(NOW);
  });

  it("devuelve el QR operativo recuperado por el store sin renovar expiresAt", async () => {
    const existing: QrOperationalRecord = {
      id: "qr-existente",
      tripId: TRIP_ID,
      tokenHash: "c".repeat(64),
      token: "token-operativo-existente",
      createdAt: new Date(NOW.getTime() - 60_000),
      expiresAt: new Date(NOW.getTime() + 240_000),
      usedAt: null,
    };
    const { deps, generateQrDataUrl } = createDeps({
      getOrCreateResult: { record: existing, created: false },
    });
    const service = createQrService(deps);

    const result = await service.generateQr(TRIP_ID);

    expect(result).toEqual({
      token: existing.token,
      qrDataUrl: QR_DATA_URL,
      expiresAt: existing.expiresAt.toISOString(),
    });
    expect(generateQrDataUrl).toHaveBeenCalledWith(existing.token);
  });

  it("convierte un fallo de generateQrDataUrl en 500 QR_PROCESSING_ERROR sin filtrar el mensaje interno", async () => {
    const internalMessage = "fallo interno de la librería qrcode: buffer corrupto";
    const { deps } = createDeps({
      generateQrDataUrl: vi.fn().mockRejectedValue(new Error(internalMessage)),
    });
    const service = createQrService(deps);

    const error = await captureAsyncApiError(() => service.generateQr(TRIP_ID));

    expect(error.status).toBe(500);
    expect(error.code).toBe("QR_PROCESSING_ERROR");
    expect(error.message).toBe("No fue posible generar el QR.");
    expect(error.message).not.toContain(internalMessage);
    expect(error.message).not.toContain(TOKEN);
  });
});

describe("createQrService — validateQr", () => {
  it("devuelve { valid: true } cuando el store confirma OK", async () => {
    const { deps } = createDeps({ consumeOutcome: "OK" });
    const service = createQrService(deps);

    const result = await service.validateQr(TRIP_ID, TOKEN);

    expect(result).toEqual({ valid: true });
  });

  it("le pasa a consumeIfValid el hash SHA-256 del token, nunca el token en claro", async () => {
    const { deps, consumeIfValid } = createDeps({ consumeOutcome: "OK" });
    const service = createQrService(deps);

    await service.validateQr(TRIP_ID, TOKEN);

    const expectedHash = createHash("sha256").update(TOKEN).digest("hex");
    expect(consumeIfValid).toHaveBeenCalledWith(expectedHash, TRIP_ID, NOW);
  });

  it.each<[ConsumeOutcome, number, string]>([
    ["NOT_FOUND", 404, "QR_NOT_FOUND"],
    ["TRIP_MISMATCH", 404, "QR_NOT_FOUND"],
    ["ALREADY_USED", 409, "QR_ALREADY_USED"],
    ["EXPIRED", 410, "QR_EXPIRED"],
  ])("traduce %s a %i %s", async (outcome, expectedStatus, expectedCode) => {
    const { deps } = createDeps({ consumeOutcome: outcome });
    const service = createQrService(deps);

    const error = await captureAsyncApiError(() => service.validateQr(TRIP_ID, TOKEN));

    expect(error.status).toBe(expectedStatus);
    expect(error.code).toBe(expectedCode);
  });

  it.each<ConsumeOutcome>(["NOT_FOUND", "TRIP_MISMATCH", "ALREADY_USED", "EXPIRED"])(
    "el message del ApiError para %s no contiene el token ni el tripId recibidos",
    async (outcome) => {
      const { deps } = createDeps({ consumeOutcome: outcome });
      const service = createQrService(deps);

      const error = await captureAsyncApiError(() => service.validateQr(TRIP_ID, TOKEN));

      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain(TRIP_ID);
    },
  );

  it("NOT_FOUND y TRIP_MISMATCH producen exactamente la misma respuesta hacia afuera", async () => {
    const notFoundError = await captureAsyncApiError(() =>
      createQrService(createDeps({ consumeOutcome: "NOT_FOUND" }).deps).validateQr(TRIP_ID, TOKEN),
    );
    const tripMismatchError = await captureAsyncApiError(() =>
      createQrService(createDeps({ consumeOutcome: "TRIP_MISMATCH" }).deps).validateQr(TRIP_ID, TOKEN),
    );

    expect(tripMismatchError.status).toBe(notFoundError.status);
    expect(tripMismatchError.code).toBe(notFoundError.code);
    expect(tripMismatchError.message).toBe(notFoundError.message);
  });
});

describe("createQrService — almacenamiento no disponible", () => {
  const STORE_UNAVAILABLE_MESSAGE =
    "El servicio de QR no está disponible en este momento. Intente nuevamente más tarde.";

  function unavailable(operation: "get-or-create" | "consume", outcomeUnknown: boolean): QrStoreUnavailableError {
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:6379"), { name: "ConnectionError" });
    return new QrStoreUnavailableError(operation, outcomeUnknown, { cause });
  }

  function expectStoreUnavailable(error: ApiError): void {
    expect(error.status).toBe(503);
    expect(error.code).toBe("QR_STORE_UNAVAILABLE");
    expect(error.message).toBe(STORE_UNAVAILABLE_MESSAGE);
    expect(error.details).toBeUndefined();
    expect(error.headers).toEqual({ "Retry-After": String(STORE_RETRY_AFTER_SECONDS) });
    expect(STORE_RETRY_AFTER_SECONDS).toBe(5);
  }

  it("generateQr responde 503 si falla el get-or-create y no devuelve el token", async () => {
    const { deps, getOrCreateActive } = createDeps();
    getOrCreateActive.mockRejectedValue(unavailable("get-or-create", false));

    const error = await captureAsyncApiError(() => createQrService(deps).generateQr(TRIP_ID));

    expectStoreUnavailable(error);
    expect(vi.mocked(deps.log)).toHaveBeenCalledWith("warn", "almacenamiento de QR no disponible", {
      event: "qr.store_unavailable",
      operation: "get-or-create",
      tripId: TRIP_ID,
      errorName: "ConnectionError",
    });
    expect(vi.mocked(deps.log).mock.calls.some(([, , fields]) => fields?.event === "qr.issued")).toBe(false);
  });

  it("validateQr responde 503 si falla el consumo y nunca aprueba el QR (fail-closed)", async () => {
    const { deps, consumeIfValid } = createDeps();
    consumeIfValid.mockRejectedValue(unavailable("consume", true));

    const error = await captureAsyncApiError(() => createQrService(deps).validateQr(TRIP_ID, TOKEN));

    expectStoreUnavailable(error);
    expect(vi.mocked(deps.log)).toHaveBeenCalledWith("warn", "almacenamiento de QR no disponible", {
      event: "qr.store_unavailable",
      operation: "consume",
      tripId: TRIP_ID,
      errorName: "ConnectionError",
      outcomeUnknown: true,
    });
    expect(vi.mocked(deps.log).mock.calls.some(([, , fields]) => fields?.event === "qr.validated")).toBe(false);
  });

  it("el log de la falla no incluye el token, el mensaje de la causa ni la pila", async () => {
    const { deps, consumeIfValid } = createDeps();
    consumeIfValid.mockRejectedValue(unavailable("consume", false));

    await captureAsyncApiError(() => createQrService(deps).validateQr(TRIP_ID, TOKEN));

    const logged = JSON.stringify(vi.mocked(deps.log).mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("ECONNREFUSED");
    expect(logged).not.toContain("stack");
  });

  it.each([
    ["una respuesta inesperada de script", () => new QrScriptReplyError("qrConsume")],
    ["un error inesperado", () => new TypeError("defecto")],
  ])("%s del store no se traduce a 503", async (_label, makeError) => {
    const { deps, consumeIfValid } = createDeps();
    const storeError = makeError();
    consumeIfValid.mockRejectedValue(storeError);

    await expect(createQrService(deps).validateQr(TRIP_ID, TOKEN)).rejects.toBe(storeError);
  });
});
