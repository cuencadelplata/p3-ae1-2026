import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ReservationCache } from '../../src/cache/reservation-cache.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import type { Reserva } from '../../src/domain/reserva.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo } from '../helpers/route.js';

const input = () => ({
  clienteId: randomUUID(),
  origen: 'A',
  destino: 'B',
  vehiculo: 'MOTO' as const,
  fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
});

describe('ReservaService', () => {
  it('crea PROGRAMADA sin invocar M5 y degrada la tarifa si M7 falla', async () => {
    const repository = new InMemoryReservaRepository();
    const tarifa: TarifaClient = {
      estimar: vi.fn(async () => Promise.reject(new Error('M7 caído'))),
    };
    const dispatch = { createRequest: vi.fn(), getRequest: vi.fn(), cancelRequest: vi.fn() };
    const service = new ReservaService(
      repository,
      tarifa,
      routeResolverDemo(),
      undefined,
      undefined,
      dispatch,
    );

    const reserva = await service.crear(input());

    expect(reserva).toMatchObject({
      estado: 'PROGRAMADA',
      tarifaEstimada: null,
      routeSnapshot: null,
      assignedDriverId: null,
      idSolicitud: null,
    });
    expect(dispatch.createRequest).not.toHaveBeenCalled();
  });

  it('persiste RouteSnapshot y trazabilidad de la estimación M7', async () => {
    const service = new ReservaService(
      new InMemoryReservaRepository(),
      { estimar: async () => fareEstimate(1_500) },
      routeResolverDemo(),
    );

    await expect(service.crear(input())).resolves.toMatchObject({
      tarifaEstimada: 1_500,
      estimacionTarifaId: 'est_test',
      routeSnapshot: { distanceKm: 10, estimatedDurationMin: 20 },
    });
  });

  it('actualiza la caché con el estado cancelado', async () => {
    const repository = new InMemoryReservaRepository();
    const values = new Map<string, Reserva>();
    const cache: ReservationCache = {
      get: async (id) => values.get(id) ?? null,
      set: async (reserva) => void values.set(reserva.id, structuredClone(reserva)),
      invalidate: async (id) => void values.delete(id),
    };
    const service = new ReservaService(
      repository,
      { estimar: async () => fareEstimate(1_500) },
      routeResolverDemo(),
      cache,
    );
    const creada = await service.crear(input());

    await service.cancelar(creada.id);

    await expect(service.obtenerPorId(creada.id)).resolves.toMatchObject({
      id: creada.id,
      estado: 'CANCELADA',
      assignedDriverId: null,
    });
  });
});
