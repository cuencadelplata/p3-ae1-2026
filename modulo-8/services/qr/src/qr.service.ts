import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "./http/api-error";
import type { Logger } from "./observability/logger";
import type { GeneratedQrToken } from "./qr-generator";
import type { QrConfig } from "./qr.config";
import type { ConsumeOutcome, QrStore } from "./qr.store";
import type { QrGenerationResponse, QrRecord, QrValidationResponse } from "./qr.types";

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

// Largo del prefijo del tokenHash que se registra en los logs: alcanza para correlacionar
// eventos de un mismo QR sin publicar el hash completo. El token en claro nunca se registra.
const LOGGED_TOKEN_HASH_LENGTH = 8;

// El tripId llega del cliente sin largo máximo (sólo lo acota el tamaño del cuerpo): en los
// logs se recorta para que una línea no crezca sin límite. La validación y el registro
// guardado usan el valor completo.
const LOGGED_TRIP_ID_MAX_LENGTH = 64;
const TRUNCATION_MARK = "…";

export function loggableTripId(tripId: string): string {
  return tripId.length > LOGGED_TRIP_ID_MAX_LENGTH
    ? `${tripId.slice(0, LOGGED_TRIP_ID_MAX_LENGTH)}${TRUNCATION_MARK}`
    : tripId;
}

type RejectionReason = Exclude<ConsumeOutcome, "OK">;

export function createQrService(deps: QrServiceDeps): QrService {
  const hashPrefix = (tokenHash: string): string => tokenHash.slice(0, LOGGED_TOKEN_HASH_LENGTH);

  // El motivo es interno: TRIP_MISMATCH se registra para diagnóstico, pero hacia afuera es
  // el mismo 404 que NOT_FOUND. Se registra en warn porque es el único rechazo que indica un
  // QR presentado para otro viaje.
  function logRejection(tripId: string, tokenHash: string, reason: RejectionReason): void {
    deps.log(reason === "TRIP_MISMATCH" ? "warn" : "info", "QR rechazado", {
      event: "qr.rejected",
      tripId: loggableTripId(tripId),
      tokenHashPrefix: hashPrefix(tokenHash),
      reason,
    });
  }

  async function generateQr(tripId: string): Promise<QrGenerationResponse> {
    const { token, tokenHash } = deps.generateQrToken();

    let qrDataUrl: string;
    try {
      qrDataUrl = await deps.generateQrDataUrl(token);
    } catch (error) {
      // Sólo el nombre del error: el mensaje de la biblioteca podría incluir el contenido.
      deps.log("error", "no fue posible generar la imagen del QR", {
        tripId: loggableTripId(tripId),
        errorName: error instanceof Error ? error.name : typeof error,
      });
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

    await deps.store.save(record);
    deps.log("info", "QR emitido", {
      event: "qr.issued",
      tripId: loggableTripId(tripId),
      tokenHashPrefix: hashPrefix(tokenHash),
      expiresAt: expiresAt.toISOString(),
    });

    return { token, qrDataUrl, expiresAt: expiresAt.toISOString() };
  }

  async function validateQr(tripId: string, token: string): Promise<QrValidationResponse> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const outcome = await deps.store.consumeIfValid(tokenHash, tripId, deps.now());

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
