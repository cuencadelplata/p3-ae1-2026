import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createQrService, type QrServiceDeps } from "../../../src/qr/qr.service";
import type { ConsumeOutcome } from "../../../src/qr/qr.store";
import { ApiError } from "../../../src/shared/api-error";

const TRIP_ID = "trip-demo-001";
const NOW = new Date("2026-09-01T12:00:00.000Z");
const TTL_SECONDS = 300;
const TOKEN = "token-en-claro-de-prueba";
const TOKEN_HASH = "b".repeat(64);
const QR_DATA_URL = "data:image/png;base64,AAAA";

interface DepsOverrides {
  consumeOutcome?: ConsumeOutcome;
  generateQrDataUrl?: ReturnType<typeof vi.fn<(token: string) => Promise<string>>>;
}

function createDeps(overrides: DepsOverrides = {}) {
  const save = vi.fn<(record: unknown) => void>();
  const consumeIfValid = vi
    .fn<(tokenHash: string, tripId: string, now: Date) => ConsumeOutcome>()
    .mockReturnValue(overrides.consumeOutcome ?? "OK");
  const generateQrDataUrl =
    overrides.generateQrDataUrl ?? vi.fn<(token: string) => Promise<string>>().mockResolvedValue(QR_DATA_URL);

  const deps: QrServiceDeps = {
    store: { save, consumeIfValid },
    config: { ttlSeconds: TTL_SECONDS },
    generateQrToken: () => ({ token: TOKEN, tokenHash: TOKEN_HASH }),
    generateQrDataUrl,
    now: () => NOW,
  };

  return { deps, save, consumeIfValid, generateQrDataUrl };
}

function captureApiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Se esperaba que la función lance un ApiError.");
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
  it("guarda un QrRecord con tokenHash (nunca el token en claro) y expiresAt = createdAt + ttlSeconds", async () => {
    const { deps, save } = createDeps();
    const service = createQrService(deps);

    await service.generateQr(TRIP_ID);

    expect(save).toHaveBeenCalledTimes(1);
    const savedRecord = save.mock.calls[0][0];
    expect(savedRecord).toEqual({
      id: expect.any(String),
      tripId: TRIP_ID,
      tokenHash: TOKEN_HASH,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL_SECONDS * 1000),
      usedAt: null,
    });
    expect(savedRecord).not.toHaveProperty("token");
  });

  it("devuelve el token en claro, el qrDataUrl y expiresAt en ISO 8601", async () => {
    const { deps } = createDeps();
    const service = createQrService(deps);

    const result = await service.generateQr(TRIP_ID);

    expect(result).toEqual({
      token: TOKEN,
      qrDataUrl: QR_DATA_URL,
      expiresAt: new Date(NOW.getTime() + TTL_SECONDS * 1000).toISOString(),
    });
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
  });

  it("no llama a store.save cuando generateQrDataUrl rechaza", async () => {
    const { deps, save } = createDeps({
      generateQrDataUrl: vi.fn<(token: string) => Promise<string>>().mockRejectedValue(new Error("boom")),
    });
    const service = createQrService(deps);

    await captureAsyncApiError(() => service.generateQr(TRIP_ID));

    expect(save).not.toHaveBeenCalled();
  });
});

describe("createQrService — validateQr", () => {
  it("devuelve { valid: true } cuando el store confirma OK", () => {
    const { deps } = createDeps({ consumeOutcome: "OK" });
    const service = createQrService(deps);

    const result = service.validateQr(TRIP_ID, TOKEN);

    expect(result).toEqual({ valid: true });
  });

  it("le pasa a consumeIfValid el hash SHA-256 del token, nunca el token en claro", () => {
    const { deps, consumeIfValid } = createDeps({ consumeOutcome: "OK" });
    const service = createQrService(deps);

    service.validateQr(TRIP_ID, TOKEN);

    const expectedHash = createHash("sha256").update(TOKEN).digest("hex");
    expect(consumeIfValid).toHaveBeenCalledWith(expectedHash, TRIP_ID, NOW);
  });

  it.each<[ConsumeOutcome, number, string]>([
    ["NOT_FOUND", 404, "QR_NOT_FOUND"],
    ["TRIP_MISMATCH", 404, "QR_NOT_FOUND"],
    ["ALREADY_USED", 409, "QR_ALREADY_USED"],
    ["EXPIRED", 410, "QR_EXPIRED"],
  ])("traduce %s a %i %s", (outcome, expectedStatus, expectedCode) => {
    const { deps } = createDeps({ consumeOutcome: outcome });
    const service = createQrService(deps);

    const error = captureApiError(() => service.validateQr(TRIP_ID, TOKEN));

    expect(error.status).toBe(expectedStatus);
    expect(error.code).toBe(expectedCode);
  });

  it.each<ConsumeOutcome>(["NOT_FOUND", "TRIP_MISMATCH", "ALREADY_USED", "EXPIRED"])(
    "el message del ApiError para %s no contiene el token ni el tripId recibidos",
    (outcome) => {
      const { deps } = createDeps({ consumeOutcome: outcome });
      const service = createQrService(deps);

      const error = captureApiError(() => service.validateQr(TRIP_ID, TOKEN));

      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain(TRIP_ID);
    },
  );

  it("NOT_FOUND y TRIP_MISMATCH producen exactamente la misma respuesta hacia afuera", () => {
    const notFoundError = captureApiError(() =>
      createQrService(createDeps({ consumeOutcome: "NOT_FOUND" }).deps).validateQr(TRIP_ID, TOKEN),
    );
    const tripMismatchError = captureApiError(() =>
      createQrService(createDeps({ consumeOutcome: "TRIP_MISMATCH" }).deps).validateQr(TRIP_ID, TOKEN),
    );

    expect(tripMismatchError.status).toBe(notFoundError.status);
    expect(tripMismatchError.code).toBe(notFoundError.code);
    expect(tripMismatchError.message).toBe(notFoundError.message);
  });
});
