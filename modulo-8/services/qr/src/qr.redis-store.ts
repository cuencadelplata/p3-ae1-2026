import type { QrStore } from "./qr.store";
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
    await client.qrSave({
      key: keyFor(record.tokenHash),
      id: record.id,
      tripId: record.tripId,
      createdAtMs: record.createdAt.getTime(),
      expiresAtMs: record.expiresAt.getTime(),
      usedAtMs: record.usedAt === null ? null : record.usedAt.getTime(),
      graceMs,
    });
  }

  async function consumeIfValid(tokenHash: string, tripId: string, _now: Date) {
    return client.qrConsume(keyFor(tokenHash), tripId);
  }

  return { save, consumeIfValid };
}
