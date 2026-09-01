import type { QrRecord } from "./qr.types";

export type ConsumeOutcome = "OK" | "NOT_FOUND" | "TRIP_MISMATCH" | "ALREADY_USED" | "EXPIRED";

export interface QrStore {
  save(record: QrRecord): void;
  consumeIfValid(tokenHash: string, tripId: string, now: Date): ConsumeOutcome;
}

export function createQrStore(): QrStore {
  const records = new Map<string, QrRecord>();

  function save(record: QrRecord): void {
    records.set(record.tokenHash, record);
  }

  // Debe permanecer síncrona de punta a punta. La comprobación de estado y la marca de
  // usedAt tienen que ocurrir en la misma ejecución del event loop: si esta función
  // ganara un await/callback en el medio, dos validaciones concurrentes del mismo QR
  // podrían intercalarse entre el chequeo y la marca, y ambas terminarían consumiéndolo
  // con éxito.
  function consumeIfValid(tokenHash: string, tripId: string, now: Date): ConsumeOutcome {
    const record = records.get(tokenHash);

    if (record === undefined) {
      return "NOT_FOUND";
    }

    if (record.tripId !== tripId) {
      return "TRIP_MISMATCH";
    }

    if (record.usedAt !== null) {
      return "ALREADY_USED";
    }

    if (now.getTime() >= record.expiresAt.getTime()) {
      return "EXPIRED";
    }

    record.usedAt = now;
    return "OK";
  }

  return { save, consumeIfValid };
}
