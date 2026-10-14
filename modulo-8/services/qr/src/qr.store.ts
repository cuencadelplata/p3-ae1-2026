import type { QrRecord } from "./qr.types";

export type ConsumeOutcome = "OK" | "NOT_FOUND" | "TRIP_MISMATCH" | "ALREADY_USED" | "EXPIRED";

export type QrStoreOperation = "save" | "get-or-create" | "consume";

export interface QrOperationalRecord extends QrRecord {
  readonly token: string;
}

export interface QrGetOrCreateResult {
  readonly record: QrOperationalRecord;
  readonly created: boolean;
}

// El almacenamiento no pudo completar la operación por una falla de infraestructura (sin
// conexión, demora, error informado por el almacenamiento). La causa original queda en
// `cause` sólo para diagnóstico: no se serializa en respuestas ni se registra completa.
//
// outcomeUnknown indica que la operación pudo haberse aplicado igual (por ejemplo, el comando
// se envió y la respuesta no llegó a tiempo): un reintento puede encontrar el QR ya consumido.
export class QrStoreUnavailableError extends Error {
  constructor(
    readonly operation: QrStoreOperation,
    readonly outcomeUnknown: boolean,
    options: { cause: unknown },
  ) {
    super(`El almacenamiento de QR no está disponible (${operation}).`, options);
    this.name = "QrStoreUnavailableError";
  }

  // Tipo del error original, para registrar la falla sin su mensaje. Algunos errores del
  // cliente Redis no definen name: en ese caso se usa el nombre de su clase.
  get causeName(): string {
    if (!(this.cause instanceof Error)) {
      return typeof this.cause;
    }
    return this.cause.name !== "Error" ? this.cause.name : this.cause.constructor.name;
  }
}

// Contrato de almacenamiento de QR. Es asíncrono para admitir un almacenamiento externo
// compartido entre instancias; cada implementación debe garantizar que consumeIfValid
// compruebe y marque el uso como una única operación atómica.
//
// `now` es la hora del proceso que valida. Un store con reloj propio (por ejemplo, Redis)
// puede ignorarlo y decidir el vencimiento con su propia hora.
export interface QrStore {
  save(record: QrRecord): Promise<void>;
  getOrCreateActive(record: QrOperationalRecord, now: Date): Promise<QrGetOrCreateResult>;
  consumeIfValid(tokenHash: string, tripId: string, now: Date): Promise<ConsumeOutcome>;
}

// Implementación en memoria: el estado vive en el proceso, se pierde al reiniciar y no se
// comparte entre instancias.
export function createInMemoryQrStore(): QrStore {
  const records = new Map<string, QrOperationalRecord | QrRecord>();

  async function save(record: QrRecord): Promise<void> {
    records.set(record.tokenHash, record);
  }

  async function getOrCreateActive(record: QrOperationalRecord, now: Date): Promise<QrGetOrCreateResult> {
    for (const existing of records.values()) {
      if (
        existing.tripId === record.tripId &&
        existing.usedAt === null &&
        now.getTime() < existing.expiresAt.getTime() &&
        "token" in existing
      ) {
        return { record: existing, created: false };
      }
    }

    records.set(record.tokenHash, record);
    return { record, created: true };
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

  return { save, getOrCreateActive, consumeIfValid };
}
