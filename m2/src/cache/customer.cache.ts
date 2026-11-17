import { runRedisCommand } from '../config/redis.js';
import { logger } from '../observability/logging.js';
import { recordCacheOperation } from '../observability/metrics.js';
import { CustomerProfileSchema, type CustomerProfile } from '../types/customer.js';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expirationMode: 'EX', ttlSeconds: number): Promise<string | null>;
  del(key: string): Promise<number>;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const redisStore: CacheStore = {
  get: (key) => runRedisCommand((client) => client.get(key)),
  set: (key, value, expirationMode, ttlSeconds) => runRedisCommand(
    (client) => client.set(key, value, expirationMode, ttlSeconds)
  ),
  del: (key) => runRedisCommand((client) => client.del(key))
};

export class CustomerCache {
  constructor(
    private readonly store: CacheStore,
    private readonly ttlSeconds = positiveIntFromEnv('CUSTOMER_CACHE_TTL_SECONDS', 300)
  ) {}

  private key(customerId: string): string {
    return `customer:profile:${customerId}`;
  }

  async get(customerId: string): Promise<CustomerProfile | null> {
    try {
      const serialized = await this.store.get(this.key(customerId));
      if (serialized === null) {
        recordCacheOperation('get', 'miss');
        return null;
      }

      const parsed = CustomerProfileSchema.safeParse(JSON.parse(serialized));
      if (!parsed.success) {
        recordCacheOperation('get', 'error');
        logger.warn({ customerId }, 'cache.profile.invalid');
        return null;
      }

      recordCacheOperation('get', 'hit');
      return parsed.data;
    } catch (error) {
      recordCacheOperation('get', 'error');
      logger.warn({ err: error, customerId }, 'cache.profile.read_failed');
      return null;
    }
  }

  async set(customerId: string, profile: CustomerProfile): Promise<void> {
    try {
      await this.store.set(this.key(customerId), JSON.stringify(profile), 'EX', this.ttlSeconds);
      recordCacheOperation('set', 'success');
    } catch (error) {
      recordCacheOperation('set', 'error');
      logger.warn({ err: error, customerId }, 'cache.profile.write_failed');
    }
  }

  async invalidate(customerId: string): Promise<void> {
    try {
      await this.store.del(this.key(customerId));
      recordCacheOperation('invalidate', 'success');
    } catch (error) {
      recordCacheOperation('invalidate', 'error');
      logger.warn({ err: error, customerId }, 'cache.profile.invalidate_failed');
    }
  }
}

export const customerCache = new CustomerCache(redisStore);
