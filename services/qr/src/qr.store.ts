import type { QrRecord } from "./qr.types";

export type ConsumeOutcome = "OK" | "NOT_FOUND" | "TRIP_MISMATCH" | "ALREADY_USED" | "EXPIRED";

// Contrato de almacenamiento de QR. Es asíncrono para admitir un almacenamiento externo
// compartido entre instancias; cada implementación debe garantizar que consumeIfValid
// compruebe y marque el uso como una única operación atómica.
export interface QrStore {
  save(record: QrRecord): Promise<void>;
  consumeIfValid(tokenHash: string, tripId: string, now: Date): Promise<ConsumeOutcome>;
}

// Implementación en memoria: el estado vive en el proceso, se pierde al reiniciar y no se
// comparte entre instancias.
export function createInMemoryQrStore(): QrStore {
  const records = new Map<string, QrRecord>();

  async function save(record: QrRecord): Promise<void> {
    records.set(record.tokenHash, record);
  }

  // El cuerpo no debe contener ningún await. Una función async se ejecuta de forma
  // síncrona hasta su primer await, así que la comprobación de estado y la marca de
  // usedAt ocurren en la misma ejecución del event loop. Si se agregara un await en el
  // medio, dos validaciones concurrentes del mismo QR podrían intercalarse entre el
  // chequeo y la marca, y ambas terminarían consumiéndolo con éxito.
  async function consumeIfValid(tokenHash: string, tripId: string, now: Date): Promise<ConsumeOutcome> {
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
