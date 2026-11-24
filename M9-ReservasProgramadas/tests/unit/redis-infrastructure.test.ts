import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { RedisReservationCache } from '../../src/cache/redis-reservation-cache.js';
import type { RedisClient } from '../../src/infrastructure/redis/redis.connection.js';
import { RedisDistributedLock } from '../../src/locks/redis-distributed-lock.js';

const reserva = {
  id: randomUUID(),
  clienteId: randomUUID(),
  origen: 'A',
  destino: 'B',
  vehiculo: 'AUTO' as const,
  fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
  estado: 'PROGRAMADA' as const,
  tarifaEstimada: 100,
  moneda: 'ARS',
  estimacionTarifaId: 'est_test',
  routeSnapshot: null,
  criterioAsignacion: null,
  idSolicitud: null,
  assignedDriverId: null,
  creadoEn: new Date().toISOString(),
  actualizadoEn: new Date().toISOString(),
};

describe('infraestructura Redis', () => {
  it('cubre miss, hit, TTL e invalidación de caché', async () => {
    let value: string | null = null;
    const client = {
      isReady: true,
      get: vi.fn(async () => value),
      set: vi.fn(async (_key: string, next: string) => {
        value = next;
        return 'OK';
      }),
      del: vi.fn(async () => {
        value = null;
        return 1;
      }),
    } as unknown as RedisClient;
    const cache = new RedisReservationCache(client, 30);

    expect(await cache.get(reserva.id)).toBeNull();
    await cache.set(reserva);
    expect(client.set).toHaveBeenCalledWith(`cache:reserva:${reserva.id}`, expect.any(String), {
      expiration: { type: 'EX', value: 30 },
    });
    expect(await cache.get(reserva.id)).toEqual(reserva);
    await cache.invalidate(reserva.id);
    expect(await cache.get(reserva.id)).toBeNull();
  });

  it('usa NX, TTL y libera verificando el token', async () => {
    const client = {
      isReady: true,
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    } as unknown as RedisClient;
    const lock = new RedisDistributedLock(client, 5_000);
    await expect(lock.runExclusive('lock:test', async () => 'ok')).resolves.toBe('ok');
    expect(client.set).toHaveBeenCalledWith('lock:test', expect.any(String), {
      condition: 'NX',
      expiration: { type: 'PX', value: 5_000 },
    });
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('GET'"), {
      keys: ['lock:test'],
      arguments: [expect.any(String)],
    });
  });

  it('rechaza un segundo lock y falla cerrado sin Redis', async () => {
    const busy = {
      isReady: true,
      set: vi.fn().mockResolvedValue(null),
    } as unknown as RedisClient;
    await expect(
      new RedisDistributedLock(busy, 100).runExclusive('lock:test', async () => undefined),
    ).rejects.toMatchObject({ code: 'RESERVA_EN_PROCESO' });

    const down = { isReady: false } as unknown as RedisClient;
    await expect(
      new RedisDistributedLock(down, 100).runExclusive('lock:test', async () => undefined),
    ).rejects.toMatchObject({ code: 'COORDINACION_NO_DISPONIBLE' });
  });
});
