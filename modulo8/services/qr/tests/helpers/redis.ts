import { randomUUID } from "node:crypto";

import { createQrRedisClient, type QrRedisClient } from "../../src/redis-client";

export const TEST_REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const CONNECT_DEADLINE_MS = 3000;

// Prefijo propio de una corrida de pruebas. Redis es compartido con otros servicios: las
// pruebas sólo crean y borran claves bajo este prefijo.
export function uniqueTestKeyPrefix(): string {
  return `m8:qr:test:${randomUUID()}:`;
}

// Conecta un cliente real. Si Redis no responde, falla con instrucciones en vez de saltear
// las pruebas: el cliente reintenta indefinidamente, por eso la espera tiene un límite.
export async function connectTestRedisClient(): Promise<QrRedisClient> {
  const client = createQrRedisClient({ url: TEST_REDIS_URL, log: () => {} });

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Redis no está disponible en ${TEST_REDIS_URL}. Estas pruebas necesitan un Redis real: ` +
              "levantalo desde modulo-8/ con `docker compose up -d redis` o indicá otra URL en REDIS_URL.",
          ),
        ),
      CONNECT_DEADLINE_MS,
    );
  });

  try {
    await Promise.race([client.connect(), deadline]);
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return client;
}

// Borra sólo las claves del prefijo indicado, recorriéndolas con SCAN.
export async function deleteKeysWithPrefix(client: QrRedisClient, keyPrefix: string): Promise<void> {
  for await (const batch of client.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 100 })) {
    const keys = ([] as string[]).concat(batch);
    if (keys.length > 0) {
      await client.del(keys);
    }
  }
}

// Hora actual de Redis en milisegundos, para que las pruebas de vencimiento no dependan del
// desfase entre el reloj del proceso y el de Redis.
export async function redisNowMs(client: QrRedisClient): Promise<number> {
  const [seconds, microseconds] = await client.time();
  return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
}
