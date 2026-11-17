import { z } from 'zod';

import { ESTADOS_RESERVA, TIPOS_VEHICULO, type Reserva } from '../domain/reserva.js';
import type { RedisClient } from '../infrastructure/redis/redis.connection.js';
import { now, recordCache, recordRedisOperation } from '../observability/metrics.js';
import type { ReservationCache } from './reservation-cache.js';

const reservaSchema = z.object({
  id: z.string(),
  clienteId: z.string(),
  origen: z.string(),
  destino: z.string(),
  vehiculo: z.enum(TIPOS_VEHICULO),
  fechaHoraProgramada: z.string(),
  estado: z.enum(ESTADOS_RESERVA),
  tarifaEstimada: z.number().nullable(),
  moneda: z.string().nullable(),
  estimacionTarifaId: z.string().nullable(),
  routeSnapshot: z
    .object({
      origin: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
      destination: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
      distanceKm: z.number(),
      estimatedDurationMin: z.number(),
    })
    .nullable(),
  criterioAsignacion: z.string().nullable(),
  idSolicitud: z.string().nullable(),
  assignedDriverId: z.string().nullable(),
  creadoEn: z.string().nullable(),
  actualizadoEn: z.string().nullable(),
});

export class RedisReservationCache implements ReservationCache {
  public constructor(
    private readonly client: RedisClient,
    private readonly ttlSeconds: number,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  // `bypass` = Redis no disponible (se degrada a PostgreSQL). No es un cache miss.
  public async get(id: string): Promise<Reserva | null> {
    if (!this.client.isReady) {
      recordCache('get', 'bypass');
      return null;
    }
    const startMs = now();
    try {
      const value = await this.client.get(this.key(id));
      recordRedisOperation('cache.get', 'ok', startMs);
      if (value === null) {
        recordCache('get', 'miss');
        return null;
      }
      const parsed = reservaSchema.parse(JSON.parse(value));
      recordCache('get', 'hit');
      return parsed;
    } catch (error) {
      recordRedisOperation('cache.get', 'error', startMs);
      recordCache('get', 'error');
      this.onError(error);
      return null;
    }
  }

  public async set(reserva: Reserva): Promise<void> {
    if (!this.client.isReady) {
      recordCache('set', 'bypass');
      return;
    }
    const startMs = now();
    try {
      await this.client.set(this.key(reserva.id), JSON.stringify(reserva), {
        expiration: { type: 'EX', value: this.ttlSeconds },
      });
      recordRedisOperation('cache.set', 'ok', startMs);
      recordCache('set', 'ok');
    } catch (error) {
      recordRedisOperation('cache.set', 'error', startMs);
      recordCache('set', 'error');
      this.onError(error);
    }
  }

  public async invalidate(id: string): Promise<void> {
    if (!this.client.isReady) {
      recordCache('invalidate', 'bypass');
      return;
    }
    const startMs = now();
    try {
      await this.client.del(this.key(id));
      recordRedisOperation('cache.invalidate', 'ok', startMs);
      recordCache('invalidate', 'ok');
    } catch (error) {
      recordRedisOperation('cache.invalidate', 'error', startMs);
      recordCache('invalidate', 'error');
      this.onError(error);
    }
  }

  private key(id: string): string {
    return `cache:reserva:${id}`;
  }
}
