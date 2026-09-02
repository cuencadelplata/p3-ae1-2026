import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ReservasScheduler } from '../../src/jobs/reservas.scheduler.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';

describe('concurrencia entre componentes de activación', () => {
  it('permite que un solo scheduler active una reserva compartida', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await repository.crear({
      clienteId: randomUUID(),
      origen: 'Terminal',
      destino: 'Aeropuerto',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() - 60_000).toISOString(),
    });
    const crearSolicitud = vi.fn(async () => ({
      solicitudId: randomUUID(),
      estado: 'CREADA',
    }));
    const activacionService = new ActivacionReservaService(repository, { crearSolicitud });
    const schedulerA = new ReservasScheduler(repository, activacionService, '* * * * * *');
    const schedulerB = new ReservasScheduler(repository, activacionService, '* * * * * *');

    const resultados = await Promise.all([schedulerA.ejecutar(), schedulerB.ejecutar()]);

    expect(resultados.reduce((total, resultado) => total + resultado.activadas, 0)).toBe(1);
    expect(crearSolicitud).toHaveBeenCalledTimes(1);
    expect(await repository.obtenerPorId(reserva.id)).toMatchObject({
      estado: 'ACTIVADA',
    });
  });
});
