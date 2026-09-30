import { createClient } from 'redis';

import { env } from '../config/env';
import { createLogger } from '../observability/logger';

const log = createLogger('redis');

/**
 * Cliente de Redis del servicio. Solo guarda datos efimeros (los enlaces
 * temporales de descarga): si Redis no esta disponible, la emision y la
 * consulta de comprobantes siguen funcionando y solo fallan los enlaces.
 *
 * Con disableOfflineQueue, un comando sin conexion falla en el momento en lugar
 * de quedar esperando la reconexion, y la API responde 503.
 */
export const redis = createClient({
  url: env.redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => Math.min(200 * (retries + 1), 5000),
  },
});

// El cliente emite un error por cada intento fallido: se informa solo el primero.
let disconnected = false;
redis.on('error', (error: Error) => {
  if (!disconnected) {
    disconnected = true;
    log('error', 'sin conexion con Redis, reintentando', { reason: error.message });
  }
});
redis.on('ready', () => {
  disconnected = false;
  log('info', 'conectado');
});

// La conexion no debe impedir que el proceso termine (pruebas, apagado).
redis.unref();

let opening: Promise<unknown> | undefined;

/**
 * Abre la conexion. Si Redis no responde, el cliente sigue reintentando por su
 * cuenta y la promesa se resuelve cuando logra conectar.
 */
export async function connectRedis(): Promise<void> {
  opening ??= redis.connect();
  await opening;
}

export async function isRedisReady(): Promise<boolean> {
  return redis.isReady && (await redis.ping()) === 'PONG';
}

export async function closeRedis(): Promise<void> {
  if (redis.isOpen) {
    await redis.close();
  }
}
