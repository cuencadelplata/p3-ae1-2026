import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app.error.js';
import type { RedisClient } from '../infrastructure/redis/redis.connection.js';
import { now, recordLock, recordRedisOperation } from '../observability/metrics.js';
import type { DistributedLock } from './distributed-lock.js';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisDistributedLock implements DistributedLock {
  public constructor(
    private readonly client: RedisClient,
    private readonly ttlMs: number,
  ) {}

  public async runExclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (!this.client.isReady) {
      recordLock('unavailable');
      throw new AppError(503, 'COORDINACION_NO_DISPONIBLE', 'Redis no está disponible.');
    }
    const token = randomUUID();
    const startMs = now();
    let acquired: string | null;
    try {
      acquired = await this.client.set(key, token, {
        condition: 'NX',
        expiration: { type: 'PX', value: this.ttlMs },
      });
      recordRedisOperation('lock.acquire', 'ok', startMs);
    } catch (error) {
      recordRedisOperation('lock.acquire', 'error', startMs);
      recordLock('error');
      throw error;
    }
    if (acquired !== 'OK') {
      recordLock('conflict');
      throw new AppError(409, 'RESERVA_EN_PROCESO', 'La reserva está siendo procesada.');
    }
    recordLock('acquired');
    try {
      return await action();
    } finally {
      const releaseStartMs = now();
      // Igual que antes de AE4: un error al liberar se propaga; solo se agrega la medición.
      await this.client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] }).then(
        () => recordRedisOperation('lock.release', 'ok', releaseStartMs),
        (error: unknown) => {
          recordRedisOperation('lock.release', 'error', releaseStartMs);
          throw error;
        },
      );
    }
  }
}
