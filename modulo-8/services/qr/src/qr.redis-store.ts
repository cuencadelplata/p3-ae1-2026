import { createHash } from "node:crypto";

import { ClientClosedError, ClientOfflineError, ErrorReply } from "redis";

import { QrScriptReplyError, type GetOrCreateScriptArgs, type SaveScriptArgs } from "./qr.redis-scripts";
import {
  QrStoreUnavailableError,
  type ConsumeOutcome,
  type QrGetOrCreateResult,
  type QrOperationalRecord,
  type QrStore,
  type QrStoreOperation,
} from "./qr.store";
import type { QrRecord } from "./qr.types";
import type { QrRedisClient } from "./redis-client";

export const DEFAULT_QR_KEY_PREFIX = "m8:qr:";

// Tope de cada operación contra Redis, incluida la espera de la respuesta. Es necesario porque
// el timeout por comando de node-redis sólo cubre la espera en la cola de escritura: una vez
// enviado el comando, el cliente espera la respuesta sin límite.
export const DEFAULT_OPERATION_TIMEOUT_MS = 2000;

// Redis no respondió dentro del tope. El comando pudo haberse ejecutado igual.
export class QrStoreTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Redis no respondió dentro de ${timeoutMs} ms.`);
    this.name = "QrStoreTimeoutError";
  }
}

export interface RedisQrStoreOptions {
  readonly client: QrRedisClient;
  readonly keyPrefix?: string;
  // Margen posterior al vencimiento durante el cual el registro se conserva para responder
  // EXPIRED; después Redis borra la clave y la validación responde NOT_FOUND. Admite
  // fracciones de segundo.
  readonly expiredGraceSeconds: number;
  // Tope de cada operación, en milisegundos (por defecto, DEFAULT_OPERATION_TIMEOUT_MS).
  readonly operationTimeoutMs?: number;
}

// Errores en los que se sabe que el comando no se aplicó: el cliente no lo envió (cerrado o
// sin conexión) o Redis lo rechazó con un error. En cualquier otro caso (demora, conexión
// cortada con el comando en vuelo, error desconocido) pudo haberse ejecutado.
function commandWasNotApplied(error: unknown): boolean {
  return error instanceof ClientClosedError || error instanceof ClientOfflineError || error instanceof ErrorReply;
}

// Ejecuta una operación con tope de tiempo y traduce cualquier falla del cliente Redis (o el
// vencimiento del tope) a QrStoreUnavailableError. Una respuesta inesperada de un script es un
// defecto del servicio y se propaga sin traducir.
//
// Si vence el tope, la operación sigue pendiente en el cliente. Su resultado o su error
// posterior no tienen efecto: Promise.race ya está suscripta a ella, así que un rechazo tardío
// no queda sin manejar.
async function runWithTimeout<T>(
  operation: QrStoreOperation,
  timeoutMs: number,
  call: () => Promise<T>,
): Promise<T> {
  const pending = call();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new QrStoreTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([pending, timeout]);
  } catch (error) {
    if (error instanceof QrScriptReplyError) {
      throw error;
    }
    throw new QrStoreUnavailableError(operation, !commandWasNotApplied(error), { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

// Almacenamiento de QR en Redis, compartido por todas las instancias del servicio.
//
// Una clave por QR, `${keyPrefix}${tokenHash}`, de tipo hash con id, tripId, token, createdAt,
// expiresAt y usedAt en milisegundos desde epoch; usedAt ausente significa que no se usó.
// La clave se arma con el hash del token. El token opaco se conserva sólo como dato
// operativo mientras el QR está activo para poder responder reintentos de POST /qr.
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
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;

  const keyFor = (tokenHash: string): string => `${keyPrefix}${tokenHash}`;
  const tripKeyFor = (tripId: string): string =>
    `${keyPrefix}trip:${createHash("sha256").update(tripId).digest("hex")}`;

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
    await runWithTimeout("save", operationTimeoutMs, () => client.qrSave(args));
  }

  async function getOrCreateActive(record: QrOperationalRecord, _now: Date): Promise<QrGetOrCreateResult> {
    const args: GetOrCreateScriptArgs = {
      qrKey: keyFor(record.tokenHash),
      tripKey: tripKeyFor(record.tripId),
      keyPrefix,
      id: record.id,
      tripId: record.tripId,
      tokenHash: record.tokenHash,
      token: record.token,
      createdAtMs: record.createdAt.getTime(),
      expiresAtMs: record.expiresAt.getTime(),
      graceMs,
    };
    return runWithTimeout("get-or-create", operationTimeoutMs, () => client.qrGetOrCreate(args));
  }

  async function consumeIfValid(tokenHash: string, tripId: string, _now: Date): Promise<ConsumeOutcome> {
    const key = keyFor(tokenHash);
    return runWithTimeout("consume", operationTimeoutMs, () => client.qrConsume(key, tripKeyFor(tripId), tripId, tokenHash));
  }

  return { save, getOrCreateActive, consumeIfValid };
}
