import { randomBytes } from 'node:crypto';

import { redis } from '../cache/redis';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';

/** Prefijo de las claves del servicio (catalogo de eventos v1, seccion 7). */
const KEY_PREFIX = 'm8:receipts:link:';

/** 32 bytes aleatorios en base64url: 43 caracteres. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface DownloadLink {
  url: string;
  expiresAt: string;
}

function unavailable(): AppError {
  return AppError.unavailable(
    'DOWNLOAD_LINKS_UNAVAILABLE',
    'Los enlaces de descarga no estan disponibles en este momento. Intente nuevamente mas tarde.',
  );
}

function expired(): AppError {
  return AppError.gone('DOWNLOAD_LINK_EXPIRED', 'El enlace de descarga no existe o ya vencio');
}

/**
 * Crea un enlace temporal para descargar el PDF del comprobante de un viaje.
 *
 * El token es aleatorio y no contiene ni deriva del tripId, por lo que no se
 * puede adivinar el enlace de otro viaje. Redis lo borra al vencer el TTL: no
 * hace falta ninguna tarea de limpieza.
 */
export async function createDownloadLink(
  tripId: string,
  ttlSeconds: number = env.receiptLinkTtlSeconds,
): Promise<DownloadLink> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  try {
    await redis.set(`${KEY_PREFIX}${token}`, tripId, { expiration: { type: 'EX', value: ttlSeconds } });
  } catch {
    throw unavailable();
  }

  return {
    url: `${env.publicBaseUrl}${env.apiPrefix}/receipts/downloads/${token}`,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

/**
 * Devuelve el tripId asociado a un enlace vigente. Redis no distingue un token
 * vencido de uno que nunca existio, por eso ambos casos responden igual.
 */
export async function resolveDownloadLink(token: string): Promise<string> {
  if (!TOKEN_PATTERN.test(token)) {
    throw expired();
  }

  let tripId: string | null;
  try {
    tripId = await redis.get(`${KEY_PREFIX}${token}`);
  } catch {
    throw unavailable();
  }

  if (!tripId) {
    throw expired();
  }
  return tripId;
}
