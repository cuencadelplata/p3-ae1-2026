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
