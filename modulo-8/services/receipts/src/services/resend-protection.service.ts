import { randomUUID } from 'node:crypto';

import { redis } from '../cache/redis';
import { env } from '../config/env';
import type { Receipt } from '../models/receipt';
import { createLogger } from '../observability/logger';

const log = createLogger('resend-protection');

const CACHE_PREFIX = 'm8:receipts:cache:';
const LOCK_PREFIX = 'm8:receipts:lock:resend:';
const RATELIMIT_PREFIX = 'm8:receipts:ratelimit:resend:';

/**
 * Script Lua para liberacion atomica del lock distribuido:
 * solo borra la clave si su valor actual coincide con el token del proceso que adquirio el lock.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface LockResult {
  acquired: boolean;
  release: () => Promise<void>;
}

/**
 * Recupera los metadatos cacheados del comprobante en Redis.
 * Si Redis no esta disponible o no existe la clave, devuelve null sin lanzar error (modo degradado).
 */
export async function getCachedReceipt(tripId: string): Promise<Receipt | null> {
  try {
    const raw = await redis.get(`${CACHE_PREFIX}${tripId}`);
    if (!raw) {
      return null;
    }
    const receipt = JSON.parse(raw) as Receipt;
    log('info', 'cache hit de metadatos de comprobante', { tripId });
    return receipt;
  } catch (error) {
    log('warn', 'error al leer cache en Redis, continuando con lectura en DB', {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Guarda los metadatos del comprobante en Redis con un tiempo de vida (TTL).
 */
export async function setCachedReceipt(
  receipt: Receipt,
  ttlSeconds: number = env.receiptCacheTtlSeconds,
): Promise<void> {
  try {
    const key = `${CACHE_PREFIX}${receipt.tripId}`;
    await redis.set(key, JSON.stringify(receipt), {
      expiration: { type: 'EX', value: ttlSeconds },
    });
    log('info', 'metadatos de comprobante cacheados en Redis', {
      tripId: receipt.tripId,
      ttlSeconds,
    });
  } catch (error) {
    log('warn', 'no se pudo guardar comprobante en cache de Redis', {
      tripId: receipt.tripId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Invalida la cache de un comprobante ante actualizaciones (ej. nuevo reenvio).
 */
export async function invalidateReceiptCache(tripId: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${tripId}`);
    log('info', 'cache de comprobante invalidada', { tripId });
  } catch (error) {
    log('warn', 'error al invalidar cache en Redis', {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Adquiere un bloqueo distribuido (lock) en Redis para evitar que reenvios concurrentes
 * (por ejemplo, multiples clics en "Reenviar") disparen procesos paralelos.
 *
 * Utiliza SET NX PX para adquisicion atomica.
 */
export async function acquireResendLock(
  tripId: string,
  ttlMs: number = env.resendLockTtlMs,
): Promise<LockResult> {
  const lockToken = randomUUID();
  const lockKey = `${LOCK_PREFIX}${tripId}`;

  try {
    const reply = await redis.set(lockKey, lockToken, {
      condition: 'NX',
      expiration: { type: 'PX', value: ttlMs },
    });

    if (reply !== 'OK') {
      log('warn', 'bloqueo distribuido: reenvio en curso detectado', { tripId });
      return {
        acquired: false,
        release: async () => {},
      };
    }

    log('info', 'lock de reenvio adquirido', { tripId, ttlMs });

    return {
      acquired: true,
      release: async () => {
        try {
          await redis.eval(RELEASE_LOCK_SCRIPT, {
            keys: [lockKey],
            arguments: [lockToken],
          });
          log('info', 'lock de reenvio liberado', { tripId });
        } catch (releaseError) {
          log('warn', 'error al liberar lock de reenvio en Redis', {
            tripId,
            reason: releaseError instanceof Error ? releaseError.message : String(releaseError),
          });
        }
      },
    };
  } catch (error) {
    // Si Redis esta caido, registramos advertencia pero permitimos continuar en modo degradado
    log('warn', 'Redis no disponible al intentar adquirir lock de reenvio, operando degradado', {
      tripId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      acquired: true,
      release: async () => {},
    };
  }
}

/**
 * Aplica rate limiting en Redis para evitar abusos en las solicitudes de reenvio.
 * Limita el numero de reenvios por identificador (tripId o IP) dentro de una ventana de tiempo.
 */
export async function checkResendRateLimit(
  identifier: string,
  limit: number = env.resendRateLimitMax,
  windowSeconds: number = env.resendRateLimitWindowSeconds,
): Promise<RateLimitResult> {
  const key = `${RATELIMIT_PREFIX}${identifier}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
    const remaining = Math.max(0, limit - current);

    if (current > limit) {
      log('warn', 'limite de tasa de reenvio superado', {
        identifier,
        current,
        limit,
        retryAfterSeconds,
      });
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remaining,
      retryAfterSeconds,
    };
  } catch (error) {
    // Si Redis esta temporalmente caido, se degrada elegantemente para no interrumpir el servicio
    log('warn', 'Redis no disponible para rate limit, permitiendo solicitud en modo degradado', {
      identifier,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    };
  }
}