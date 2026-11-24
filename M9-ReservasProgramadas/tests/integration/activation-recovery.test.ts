import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors/app.error.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';
import { routeResolverDemo, routeSnapshot } from '../helpers/route.js';
import type { DispatchClient } from '../../src/clients/m5-dispatch.client.js';
const expired = {
  clienteId: '101',
  origen: 'A',
  destino: 'B',
  vehiculo: 'AUTO' as const,
  fechaHoraProgramada: new Date(Date.now() - 1000).toISOString(),
  routeSnapshot,
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('recuperacion de activacion interrumpida', () => {
  it('conserva PROGRAMADA si M4 falla y despacha al recuperarse la ruta', async () => {
    const repository = new InMemoryReservaRepository();
    const created = await repository.crear({ ...expired, routeSnapshot: null });
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('M4 no disponible'))
      .mockResolvedValue(routeSnapshot);
    const createRequest = vi.fn(async () => ({
      requestId: 'request-1',
      clientId: '101',
      status: 'SEARCHING' as const,
      assignedDriverId: null,
    }));
    const service = new ActivacionReservaService(
      repository,
      { createRequest } as unknown as DispatchClient,
      { resolve },
    );
    await expect(service.activar(created.id)).rejects.toThrow('M4 no disponible');
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'PROGRAMADA',
      idSolicitud: null,
    });
    expect(createRequest).not.toHaveBeenCalled();
    await service.activar(created.id);
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'ACTIVANDO',
      idSolicitud: 'request-1',
      routeSnapshot,
    });
  });

  it('marca FALLIDA sin reintentar si una reserva degradada resuelve a recorrido inválido (0 km)', async () => {
    const repository = new InMemoryReservaRepository();
    const created = await repository.crear({ ...expired, routeSnapshot: null });
    const createRequest = vi.fn();
    const service = new ActivacionReservaService(
      repository,
      { createRequest } as unknown as DispatchClient,
      {
        resolve: vi.fn(async () => {
          throw new AppError(
            400,
            'DATOS_INVALIDOS',
            'El origen y el destino están en el mismo punto o demasiado cercanos para programar un viaje.',
          );
        }),
      },
    );

    await expect(service.activar(created.id)).resolves.toMatchObject({
      reservaId: created.id,
      activada: false,
      fallida: true,
    });
    expect(createRequest).not.toHaveBeenCalled();
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'FALLIDA',
      idSolicitud: null,
    });
  });

  it('recupera un claim viejo sin solicitud y lo vuelve a despachar una sola vez', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const repository = new InMemoryReservaRepository();
    const created = await repository.crear(expired);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    const realGet = repository.obtenerPorId.bind(repository);
    vi.setSystemTime(now + 120001);
    const recover = vi.spyOn(repository, 'recuperarActivacion');
    const createRequest = vi.fn(async () => ({
      requestId: '44444444-4444-4444-8444-444444444444',
      clientId: '101',
      status: 'ASSIGNED' as const,
      assignedDriverId: 'driver-1',
    }));
    const dispatch: DispatchClient = { createRequest, getRequest: vi.fn(), cancelRequest: vi.fn() };
    const service = new ActivacionReservaService(repository, dispatch, routeResolverDemo());
    await service.activar(created.id);
    expect(recover).toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
    await Promise.all([service.activar(created.id), service.activar(created.id)]);
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(await realGet(created.id)).toMatchObject({
      estado: 'ACTIVADA',
      assignedDriverId: 'driver-1',
    });
  });
  it('el CAS no recupera claims recientes ni reservas con solicitud confirmada', async () => {
    const repository = new InMemoryReservaRepository();
    const created = await repository.crear(expired);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    expect(await repository.recuperarActivacion(created.id, new Date(Date.now() - 120000))).toBe(
      false,
    );
    await repository.cambiarEstado(created.id, 'ACTIVANDO', 'ACTIVANDO', {
      idSolicitud: '44444444-4444-4444-8444-444444444444',
    });
    expect(await repository.recuperarActivacion(created.id, new Date(Date.now() + 1000))).toBe(
      false,
    );
  });
  it('un claim abandonado aparece en el lote del scheduler', async () => {
    const repository = new InMemoryReservaRepository();
    const created = await repository.crear(expired);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    expect((await repository.buscarPendientes(new Date())).map((r) => r.id)).toContain(created.id);
  });
});
