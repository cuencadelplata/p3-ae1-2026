import Redis, { type RedisOptions } from 'ioredis';
import { logger } from '../observability/logging.js';
import { createPolicy } from '../resilience/policies.js';

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const redisOptions = {
  connectTimeout: positiveIntFromEnv('REDIS_CONNECT_TIMEOUT_MS', 500),
  commandTimeout: positiveIntFromEnv('REDIS_COMMAND_TIMEOUT_MS', 500),
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null
} satisfies RedisOptions;

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', redisOptions);
const redisPolicy = createPolicy('redis');

let connectionAttempt: Promise<void> | undefined;

redis.on('error', (error) => {
  logger.warn({ err: error, dependency: 'redis' }, 'redis.connection.error');
});

async function ensureRedisConnected(): Promise<void> {
  if (redis.status === 'ready') return;

  connectionAttempt ??= redis.connect().finally(() => {
    connectionAttempt = undefined;
  });
  await connectionAttempt;
}

export async function runRedisCommand<T>(command: (client: Redis) => Promise<T>): Promise<T> {
  return redisPolicy.execute(async () => {
    await ensureRedisConnected();
    return command(redis);
  }, { idempotent: true });
}

export async function testRedisConnection(): Promise<boolean> {
  try {
    return await runRedisCommand((client) => client.ping()) === 'PONG';
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export function disconnectRedis(): void {
  redis.disconnect();
}

// ── Cliente de RF-2.2 / RF-2.4 (direcciones y calificaciones) ─────────────────
// Conexión persistente con reconexión: la usan el servicio de direcciones (caché con
// revisión) y el worker (heartbeat). Usa el mismo Redis que el resto de M2: REDIS_URL,
// o REDIS_HOST/REDIS_PORT/REDIS_PASSWORD como en la configuración original de AE2.
const aeRedisOptions = {
  connectTimeout: 1000,
  commandTimeout: 1000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times: number) => Math.min(times * 200, 3000)
} satisfies RedisOptions;

function createAeRedisClient(): Redis {
  const client = process.env.REDIS_URL || !process.env.REDIS_HOST
    ? new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', aeRedisOptions)
    : new Redis({
        ...aeRedisOptions,
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined
      });
  client.on('error', () => logger.warn({ dependency: 'redis', client: 'ae2' }, 'redis_unavailable'));
  return client;
}

// Se crea en el primer uso: importar este módulo (lo hace la autenticación de toda la API)
// no debe abrir una conexión que mantenga vivo el proceso, por ejemplo en los tests.
let aeClient: Redis | undefined;
export const redisClient = new Proxy({} as Redis, {
  get(_target, property) {
    aeClient ??= createAeRedisClient();
    const value = Reflect.get(aeClient, property, aeClient);
    return typeof value === 'function' ? value.bind(aeClient) : value;
  }
});
