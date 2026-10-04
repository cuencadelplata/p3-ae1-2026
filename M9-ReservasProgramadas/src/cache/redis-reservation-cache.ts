import { z } from 'zod';

import { ESTADOS_RESERVA, TIPOS_VEHICULO, type Reserva } from '../domain/reserva.js';
import type { RedisClient } from '../infrastructure/redis/redis.connection.js';
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

  public async get(id: string): Promise<Reserva | null> {
    try {
      if (!this.client.isReady) return null;
      const value = await this.client.get(this.key(id));
      return value === null ? null : reservaSchema.parse(JSON.parse(value));
    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  public async set(reserva: Reserva): Promise<void> {
    try {
      if (!this.client.isReady) return;
      await this.client.set(this.key(reserva.id), JSON.stringify(reserva), {
        expiration: { type: 'EX', value: this.ttlSeconds },
      });
    } catch (error) {
      this.onError(error);
    }
  }

  public async invalidate(id: string): Promise<void> {
    try {
      if (this.client.isReady) await this.client.del(this.key(id));
    } catch (error) {
      this.onError(error);
    }
  }

  private key(id: string): string {
    return `cache:reserva:${id}`;
  }
}
