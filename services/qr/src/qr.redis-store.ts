import { ClientClosedError, ClientOfflineError, ErrorReply } from "redis";

import { QrScriptReplyError, type SaveScriptArgs } from "./qr.redis-scripts";
import { QrStoreUnavailableError, type ConsumeOutcome, type QrStore, type QrStoreOperation } from "./qr.store";
import type { QrRecord } from "./qr.types";
import type { QrRedisClient } from "./redis-client";

export const DEFAULT_QR_KEY_PREFIX = "m8:qr:";

export interface RedisQrStoreOptions {
  readonly client: QrRedisClient;
  readonly keyPrefix?: string;
  // Margen posterior al vencimiento durante el cual el registro se conserva para responder
  // EXPIRED; después Redis borra la clave y la validación responde NOT_FOUND. Admite
  // fracciones de segundo.
  readonly expiredGraceSeconds: number;
}

// Errores en los que se sabe que el comando no se aplicó: el cliente no lo envió (cerrado o
// sin conexión) o Redis lo rechazó con un error. En cualquier otro caso (demora, conexión
// cortada con el comando en vuelo, error desconocido) pudo haberse ejecutado.
function commandWasNotApplied(error: unknown): boolean {
  return error instanceof ClientClosedError || error instanceof ClientOfflineError || error instanceof ErrorReply;
}

// Traduce cualquier falla del cliente Redis a QrStoreUnavailableError. Una respuesta
// inesperada de un script es un defecto del servicio y se propaga sin traducir.
async function translateRedisFailure<T>(operation: QrStoreOperation, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof QrScriptReplyError) {
      throw error;
    }
    throw new QrStoreUnavailableError(operation, !commandWasNotApplied(error), { cause: error });
  }
}

// Almacenamiento de QR en Redis, compartido por todas las instancias del servicio.
//
// Una clave por QR, `${keyPrefix}${tokenHash}`, de tipo hash con id, tripId, createdAt,
// expiresAt y usedAt en milisegundos desde epoch; usedAt ausente significa que no se usó.
// La clave se arma con el hash del token: el token en claro nunca llega a Redis.
//
// El vencimiento se decide con la hora de Redis, por eso se ignora el parámetro `now`. La
// fecha expiresAt la calcula el proceso Node al generar el QR: un desfase entre ambos relojes
// adelanta o atrasa el vencimiento en esa misma medida.
export function createRedisQrStore(options: RedisQrStoreOptions): QrStore {
  if (!(options.expiredGraceSeconds > 0)) {
    throw new Error("expiredGraceSeconds debe ser mayor que cero.");
  }

  const { client } = options;
  const keyPrefix = options.keyPrefix ?? DEFAULT_QR_KEY_PREFIX;
  const graceMs = Math.ceil(options.expiredGraceSeconds * 1000);

  const keyFor = (tokenHash: string): string => `${keyPrefix}${tokenHash}`;

  async function save(record: QrRecord): Promise<void> {
    const args: SaveScriptArgs = {
      key: keyFor(record.tokenHash),
      id: record.id,
      tripId: record.tripId,
      createdAtMs: record.createdAt.getTime(),
      expiresAtMs: record.expiresAt.getTime(),
      usedAtMs: record.usedAt === null ? null : record.usedAt.getTime(),
      graceMs,
    };
    await translateRedisFailure("save", () => client.qrSave(args));
  }

  async function consumeIfValid(tokenHash: string, tripId: string, _now: Date): Promise<ConsumeOutcome> {
    const key = keyFor(tokenHash);
    return translateRedisFailure("consume", () => client.qrConsume(key, tripId));
  }

  return { save, consumeIfValid };
}
