import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { DispatchClient, M5RideRequest } from '../../src/clients/m5-dispatch.client.js';
import { ReservasScheduler } from '../../src/jobs/reservas.scheduler.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo, routeSnapshot } from '../helpers/route.js';

const assigned = (): M5RideRequest => ({
  requestId: randomUUID(),
  clientId: 'client-1',
  status: 'ASSIGNED',
  assignedDriverId: 'driver-1',
});
const dispatch = (): DispatchClient => ({
  createRequest: vi.fn(async () => assigned()),
  getRequest: vi.fn(async () => assigned()),
  cancelRequest: vi.fn(async (requestId) => ({
    ...assigned(),
    requestId,
    status: 'CANCELLED',
    assignedDriverId: null,
  })),
});
const vencida = (repository: InMemoryReservaRepository) =>
  repository.crear({
    clienteId: randomUUID(),
    origen: 'Terminal',
    destino: 'Aeropuerto',
    vehiculo: 'AUTO',
    fechaHoraProgramada: new Date(Date.now() - 60_000).toISOString(),
    routeSnapshot,
  });

describe('concurrencia entre cancelación y activación', () => {
  it('permite que un solo scheduler active una reserva compartida', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await vencida(repository);
    const client = dispatch();
    const activation = new ActivacionReservaService(repository, client, routeResolverDemo());
    const resultados = await Promise.all([
      new ReservasScheduler(repository, activation, '* * * * * *').ejecutar(),
      new ReservasScheduler(repository, activation, '* * * * * *').ejecutar(),
    ]);
    expect(resultados.reduce((total, result) => total + result.activadas, 0)).toBe(1);
    expect(client.createRequest).toHaveBeenCalledTimes(1);
    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('ACTIVADA');
  });

  it('termina en un único estado compatible al cancelar y activar a la vez', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await vencida(repository);
    const client = dispatch();
    const activation = new ActivacionReservaService(repository, client, routeResolverDemo());
    const reservations = new ReservaService(
      repository,
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
      undefined,
      undefined,
      client,
    );
    const results = await Promise.allSettled([
      activation.activar(reserva.id),
      reservations.cancelar(reserva.id),
    ]);
    const final = await repository.obtenerPorId(reserva.id);
    expect(['ACTIVADA', 'CANCELADA']).toContain(final?.estado);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(client.createRequest).toHaveBeenCalledTimes(final?.estado === 'ACTIVADA' ? 1 : 0);
  });
});
