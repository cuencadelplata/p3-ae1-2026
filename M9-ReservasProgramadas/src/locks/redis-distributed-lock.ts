import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app.error.js';
import type { RedisClient } from '../infrastructure/redis/redis.connection.js';
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
      throw new AppError(503, 'COORDINACION_NO_DISPONIBLE', 'Redis no está disponible.');
    }
    const token = randomUUID();
    const acquired = await this.client.set(key, token, {
      condition: 'NX',
      expiration: { type: 'PX', value: this.ttlMs },
    });
    if (acquired !== 'OK') {
      throw new AppError(409, 'RESERVA_EN_PROCESO', 'La reserva está siendo procesada.');
    }
    try {
      return await action();
    } finally {
      await this.client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
    }
  }
}
