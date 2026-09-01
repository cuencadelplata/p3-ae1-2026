import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "../shared/api-error";
import type { GeneratedQrToken } from "./qr-generator";
import type { QrConfig } from "./qr.config";
import type { QrStore } from "./qr.store";
import type { QrGenerationResponse, QrRecord, QrValidationResponse } from "./qr.types";

export interface QrServiceDeps {
  readonly store: QrStore;
  readonly config: QrConfig;
  readonly generateQrToken: () => GeneratedQrToken;
  readonly generateQrDataUrl: (token: string) => Promise<string>;
  readonly now: () => Date;
}

export interface QrService {
  generateQr(tripId: string): Promise<QrGenerationResponse>;
  validateQr(tripId: string, token: string): QrValidationResponse;
}

export function createQrService(deps: QrServiceDeps): QrService {
  async function generateQr(tripId: string): Promise<QrGenerationResponse> {
    const { token, tokenHash } = deps.generateQrToken();

    let qrDataUrl: string;
    try {
      qrDataUrl = await deps.generateQrDataUrl(token);
    } catch {
      throw new ApiError(500, "QR_PROCESSING_ERROR", "No fue posible generar el QR.");
    }

    const createdAt = deps.now();
    const expiresAt = new Date(createdAt.getTime() + deps.config.ttlSeconds * 1000);

    const record: QrRecord = {
      id: randomUUID(),
      tripId,
      tokenHash,
      createdAt,
      expiresAt,
      usedAt: null,
    };

    deps.store.save(record);

    return { token, qrDataUrl, expiresAt: expiresAt.toISOString() };
  }

  function validateQr(tripId: string, token: string): QrValidationResponse {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const outcome = deps.store.consumeIfValid(tokenHash, tripId, deps.now());

    switch (outcome) {
      case "OK":
        return { valid: true };
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
