import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { DespachoClient } from '../../src/clients/despacho.client.js';
import { ReservasScheduler } from '../../src/jobs/reservas.scheduler.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';

const crearVencida = (repository: InMemoryReservaRepository) =>
  repository.crear({
    clienteId: randomUUID(),
    origen: 'A',
    destino: 'B',
    vehiculo: 'AUTO',
    fechaHoraProgramada: new Date(Date.now() - 60_000).toISOString(),
  });

describe('activación programada', () => {
  it('activa una reserva vencida y persiste el id de solicitud M5', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const solicitudId = randomUUID();
    const despacho: DespachoClient = {
      crearSolicitud: vi.fn(async () => ({ solicitudId, estado: 'CREADA' })),
    };
    const scheduler = new ReservasScheduler(
      repository,
      new ActivacionReservaService(repository, despacho),
      '* * * * * *',
    );

    const resultado = await scheduler.ejecutar();
    const actualizada = await repository.obtenerPorId(reserva.id);

    expect(resultado).toEqual({ encontradas: 1, activadas: 1, fallidas: 0 });
    expect(actualizada).toMatchObject({ estado: 'ACTIVADA', idSolicitud: solicitudId });
  });

  it('permite un solo ganador ante dos activaciones concurrentes', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const crearSolicitud = vi.fn(async () => ({ solicitudId: randomUUID(), estado: 'CREADA' }));
    const service = new ActivacionReservaService(repository, { crearSolicitud });

    const resultados = await Promise.all([service.activar(reserva.id), service.activar(reserva.id)]);

    expect(resultados.filter(({ activada }) => activada)).toHaveLength(1);
    expect(crearSolicitud).toHaveBeenCalledTimes(1);
    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('ACTIVADA');
  });

  it('marca FALLIDA cuando M5 rechaza la activación', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await crearVencida(repository);
    const service = new ActivacionReservaService(repository, {
      crearSolicitud: async () => Promise.reject(new Error('M5 caído')),
    });

    await expect(service.activar(reserva.id)).rejects.toThrow('M5 caído');
    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('FALLIDA');
  });
});
