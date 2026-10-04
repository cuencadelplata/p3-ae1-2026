import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { DispatchClient, M5RideRequest } from '../../src/clients/m5-dispatch.client.js';
import { ReservasScheduler } from '../../src/jobs/reservas.scheduler.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';
import { routeResolverDemo, routeSnapshot } from '../helpers/route.js';

const crearVencida = (repository: InMemoryReservaRepository) =>
  repository.crear({
    clienteId: randomUUID(),
    origen: 'A',
    destino: 'B',
    vehiculo: 'AUTO',
    fechaHoraProgramada: new Date(Date.now() - 60_000).toISOString(),
    routeSnapshot,
  });

const ride = (status: M5RideRequest['status'], requestId = randomUUID()): M5RideRequest => ({
  requestId,
  clientId: 'client-1',
  status,
  assignedDriverId: status === 'ASSIGNED' ? 'driver-1' : null,
});

const dispatch = (created: M5RideRequest, queried = created): DispatchClient => ({
  createRequest: vi.fn(async () => created),
  getRequest: vi.fn(async () => queried),
  cancelRequest: vi.fn(async () => ride('CANCELLED', created.requestId)),
});

describe('activación programada', () => {
  it('mantiene ACTIVANDO al crear la solicitud y activa solo cuando M5 informa ASSIGNED', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const requestId = randomUUID();
    const client = dispatch(ride('SEARCHING', requestId), ride('ASSIGNED', requestId));
    const scheduler = new ReservasScheduler(
      repository,
      new ActivacionReservaService(repository, client, routeResolverDemo()),
      '* * * * * *',
    );

    await expect(scheduler.ejecutar()).resolves.toEqual({
      encontradas: 1,
      activadas: 0,
      fallidas: 0,
    });
    expect(await repository.obtenerPorId(reserva.id)).toMatchObject({
      estado: 'ACTIVANDO',
      idSolicitud: requestId,
    });
    await expect(scheduler.ejecutar()).resolves.toEqual({
      encontradas: 1,
      activadas: 1,
      fallidas: 0,
    });
    expect(await repository.obtenerPorId(reserva.id)).toMatchObject({
      estado: 'ACTIVADA',
      assignedDriverId: 'driver-1',
    });
  });

  it('permite un solo ganador ante activaciones concurrentes', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const client = dispatch(ride('ASSIGNED'));
    const service = new ActivacionReservaService(repository, client, routeResolverDemo());

    const resultados = await Promise.all([
      service.activar(reserva.id),
      service.activar(reserva.id),
    ]);

    expect(resultados.filter(({ activada }) => activada)).toHaveLength(1);
    expect(client.createRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['NO_DRIVERS_AVAILABLE', 'EXPIRED'] as const)(
    'marca FALLIDA cuando M5 informa %s',
    async (status) => {
      const repository = new InMemoryReservaRepository();
      const reserva = await crearVencida(repository);
      const service = new ActivacionReservaService(
        repository,
        dispatch(ride(status)),
        routeResolverDemo(),
      );
      await expect(service.activar(reserva.id)).resolves.toMatchObject({ fallida: true });
      expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('FALLIDA');
    },
  );

  it('vuelve a PROGRAMADA y propaga el error si M5 no confirma la solicitud', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const client = dispatch(ride('SEARCHING'));
    vi.mocked(client.createRequest).mockRejectedValueOnce(new Error('M5 caído'));
    const service = new ActivacionReservaService(repository, client, routeResolverDemo());
    await expect(service.activar(reserva.id)).rejects.toThrow('M5 caído');
    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('PROGRAMADA');
  });

  it('valida cron, evita dos jobs y devuelve cero sin pendientes', async () => {
    const repository = new InMemoryReservaRepository();
    const service = new ActivacionReservaService(
      repository,
      dispatch(ride('SEARCHING')),
      routeResolverDemo(),
    );
    expect(() => new ReservasScheduler(repository, service, 'INVALIDA').start()).toThrow();
    const scheduler = new ReservasScheduler(repository, service, '* * * * * *');
    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
    await expect(scheduler.ejecutar()).resolves.toEqual({
      encontradas: 0,
      activadas: 0,
      fallidas: 0,
    });
  });
});
