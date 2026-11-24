import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ReservationCache } from '../../src/cache/reservation-cache.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import type { Reserva } from '../../src/domain/reserva.js';
import { AppError } from '../../src/errors/app.error.js';
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
  it('rechaza otros clientes antes de consultar M7 cuando se habilita la demo', async () => {
    const tarifa = { estimar: vi.fn() };
    const service = new ReservaService(
      new InMemoryReservaRepository(),
      tarifa,
      routeResolverDemo(),
      undefined,
      undefined,
      undefined,
      '99999999-9999-4999-8999-999999999999',
    );
    await expect(service.crear(input())).rejects.toMatchObject({
      statusCode: 403,
      code: 'CLIENTE_DEMO_REQUERIDO',
    });
    expect(tarifa.estimar).not.toHaveBeenCalled();
  });

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

  it('no degrada ni persiste reservas cuando la ruta se rechaza por distancia 0 km en crear o actualizar', async () => {
    const repository = new InMemoryReservaRepository();
    const tarifa = { estimar: vi.fn(async () => fareEstimate(1_500)) };
    const routeTooShort = () =>
      new AppError(
        400,
        'DATOS_INVALIDOS',
        'El origen y el destino están en el mismo punto o demasiado cercanos para programar un viaje.',
      );
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(routeTooShort())
      .mockResolvedValueOnce({
        origin: { latitude: -27.46, longitude: -58.83, address: 'A' },
        destination: { latitude: -27.48, longitude: -58.78, address: 'B' },
        distanceKm: 4.2,
        estimatedDurationMin: 11,
      })
      .mockRejectedValueOnce(routeTooShort());
    const service = new ReservaService(repository, tarifa, { resolve });

    await expect(service.crear(input())).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATOS_INVALIDOS',
    });
    expect(await repository.listar()).toHaveLength(0);
    expect(tarifa.estimar).not.toHaveBeenCalled();

    const creada = await service.crear(input());
    await expect(service.actualizar(creada.id, { destino: 'A casi igual' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATOS_INVALIDOS',
    });
    expect(await repository.obtenerPorId(creada.id)).toMatchObject({
      destino: 'B',
      tarifaEstimada: 1_500,
    });
  });
});
