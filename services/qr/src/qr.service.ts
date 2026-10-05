import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "./http/api-error";
import type { Logger } from "./observability/logger";
import type { GeneratedQrToken } from "./qr-generator";
import type { QrConfig } from "./qr.config";
import { QrStoreUnavailableError, type ConsumeOutcome, type QrOperationalRecord, type QrStore } from "./qr.store";
import type { QrGenerationResponse, QrValidationResponse } from "./qr.types";

export interface QrServiceDeps {
  readonly store: QrStore;
  readonly config: Pick<QrConfig, "ttlSeconds">;
  readonly generateQrToken: () => GeneratedQrToken;
  readonly generateQrDataUrl: (token: string) => Promise<string>;
  readonly now: () => Date;
  readonly log: Logger;
}

export interface QrService {
  generateQr(tripId: string): Promise<QrGenerationResponse>;
  validateQr(tripId: string, token: string): Promise<QrValidationResponse>;
}

const LOGGED_TOKEN_HASH_LENGTH = 8;
const LOGGED_TRIP_ID_MAX_LENGTH = 64;
const TRUNCATION_MARK = "…";

export function loggableTripId(tripId: string): string {
  return tripId.length > LOGGED_TRIP_ID_MAX_LENGTH
    ? `${tripId.slice(0, LOGGED_TRIP_ID_MAX_LENGTH)}${TRUNCATION_MARK}`
    : tripId;
}

type RejectionReason = Exclude<ConsumeOutcome, "OK">;

export const STORE_RETRY_AFTER_SECONDS = 5;

const STORE_UNAVAILABLE_MESSAGE = "El servicio de QR no está disponible en este momento. Intente nuevamente más tarde.";

export function createQrService(deps: QrServiceDeps): QrService {
  const hashPrefix = (tokenHash: string): string => tokenHash.slice(0, LOGGED_TOKEN_HASH_LENGTH);

  function logRejection(tripId: string, tokenHash: string, reason: RejectionReason): void {
    deps.log(reason === "TRIP_MISMATCH" ? "warn" : "info", "QR rechazado", {
      event: "qr.rejected",
      tripId: loggableTripId(tripId),
      tokenHashPrefix: hashPrefix(tokenHash),
      reason,
    });
  }

  async function withStore<T>(tripId: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof QrStoreUnavailableError)) {
        throw error;
      }
      deps.log("warn", "almacenamiento de QR no disponible", {
        event: "qr.store_unavailable",
        operation: error.operation,
        tripId: loggableTripId(tripId),
        errorName: error.causeName,
        ...(error.outcomeUnknown ? { outcomeUnknown: true } : {}),
      });
      throw new ApiError(503, "QR_STORE_UNAVAILABLE", STORE_UNAVAILABLE_MESSAGE, undefined, {
        "Retry-After": String(STORE_RETRY_AFTER_SECONDS),
      });
    }
  }

  async function generateQr(tripId: string): Promise<QrGenerationResponse> {
    const { token, tokenHash } = deps.generateQrToken();
    const createdAt = deps.now();
    const expiresAt = new Date(createdAt.getTime() + deps.config.ttlSeconds * 1000);

    const candidate: QrOperationalRecord = {
      id: randomUUID(),
      tripId,
      tokenHash,
      token,
      createdAt,
      expiresAt,
      usedAt: null,
    };

    const operational = await withStore(tripId, () => deps.store.getOrCreateActive(candidate, createdAt));

    let qrDataUrl: string;
    try {
      qrDataUrl = await deps.generateQrDataUrl(operational.record.token);
    } catch (error) {
      deps.log("error", "no fue posible generar la imagen del QR", {
        tripId: loggableTripId(tripId),
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ApiError(500, "QR_PROCESSING_ERROR", "No fue posible generar el QR.");
    }

    deps.log("info", operational.created ? "QR emitido" : "QR operativo reutilizado", {
      event: operational.created ? "qr.issued" : "qr.reused",
      tripId: loggableTripId(tripId),
      tokenHashPrefix: hashPrefix(operational.record.tokenHash),
      expiresAt: operational.record.expiresAt.toISOString(),
    });

    return {
      token: operational.record.token,
      qrDataUrl,
      expiresAt: operational.record.expiresAt.toISOString(),
    };
  }

  async function validateQr(tripId: string, token: string): Promise<QrValidationResponse> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const outcome = await withStore(tripId, () => deps.store.consumeIfValid(tokenHash, tripId, deps.now()));

    if (outcome === "OK") {
      deps.log("info", "QR validado y consumido", {
        event: "qr.validated",
        tripId: loggableTripId(tripId),
        tokenHashPrefix: hashPrefix(tokenHash),
      });
      return { valid: true };
    }

    logRejection(tripId, tokenHash, outcome);

    switch (outcome) {
      case "NOT_FOUND":
      case "TRIP_MISMATCH":
        throw new ApiError(
          404,
          "QR_NOT_FOUND",
          "No se encontró un QR correspondiente al token y viaje indicados.",
        );
      case "ALREADY_USED":
        throw new ApiError(409, "QR_ALREADY_USED", "El QR ya fue utilizado.");
      case "EXPIRED":
        throw new ApiError(410, "QR_EXPIRED", "El QR ha vencido.");
    }
  }

  return { generateQr, validateQr };
}
