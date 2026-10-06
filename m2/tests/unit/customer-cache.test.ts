import { describe, expect, it } from 'vitest';
import { CustomerCache, type CacheStore } from '../../src/cache/customer.cache.js';
import type { CustomerProfile } from '../../src/types/customer.js';

class InMemoryCacheStore implements CacheStore {
  readonly values = new Map<string, string>();
  lastTtlSeconds: number | undefined;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, expirationMode: 'EX', ttlSeconds: number): Promise<string> {
    expect(expirationMode).toBe('EX');
    this.values.set(key, value);
    this.lastTtlSeconds = ttlSeconds;
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

const profile: CustomerProfile = {
  customerId: 'cust_823a7b9c',
  userId: 12,
  preferences: {
    preferredVehicleType: 'auto',
    notificationChannel: 'email'
  },
  status: 'ACTIVO',
  createdAt: '2026-08-30T23:00:00.000Z'
};

describe('Caché de perfiles de cliente', () => {
  it('guarda y recupera un perfil con TTL de cinco minutos', async () => {
    // Given
    const store = new InMemoryCacheStore();
    const cache = new CustomerCache(store);

    // When
    await cache.set(profile.customerId, profile);
    const cached = await cache.get(profile.customerId);

    // Then
    expect(cached).toEqual(profile);
    expect(store.lastTtlSeconds).toBe(300);
  });

  it('invalida la clave del perfil solicitado', async () => {
    // Given
    const store = new InMemoryCacheStore();
    const cache = new CustomerCache(store);
    await cache.set(profile.customerId, profile);

    // When
    await cache.invalidate(profile.customerId);

    // Then
    expect(await cache.get(profile.customerId)).toBeNull();
  });

  it('degrada a miss cuando Redis falla', async () => {
    // Given
    const unavailableStore: CacheStore = {
      get: async () => { throw new Error('redis unavailable'); },
      set: async () => { throw new Error('redis unavailable'); },
      del: async () => { throw new Error('redis unavailable'); }
    };
    const cache = new CustomerCache(unavailableStore);

    // When / Then
    await expect(cache.get(profile.customerId)).resolves.toBeNull();
    await expect(cache.set(profile.customerId, profile)).resolves.toBeUndefined();
    await expect(cache.invalidate(profile.customerId)).resolves.toBeUndefined();
  });

  it('descarta contenido corrupto o ajeno al esquema de perfil', async () => {
    // Given
    const store = new InMemoryCacheStore();
    store.values.set('customer:profile:cust_823a7b9c', '{"customerId": 99}');
    const cache = new CustomerCache(store);

    // When
    const cached = await cache.get(profile.customerId);

    // Then
    expect(cached).toBeNull();
  });
});
