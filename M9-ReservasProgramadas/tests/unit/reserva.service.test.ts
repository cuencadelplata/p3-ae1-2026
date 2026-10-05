import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AsignacionClient } from '../../src/clients/asignacion.client.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { asignacionClientDemo } from '../helpers/asignacion.js';

describe('ReservaService', () => {
  it('crea la reserva sin tarifa cuando M7 no está disponible', async () => {
    const repository = new InMemoryReservaRepository();
    const unavailableClient: TarifaClient = {
      estimar: async () => Promise.reject(new Error('M7 caído')),
    };
    const service = new ReservaService(repository, unavailableClient, asignacionClientDemo());

    const reserva = await service.crear({
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'MOTO',
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(reserva.estado).toBe('PROGRAMADA');
    expect(reserva.tarifaEstimada).toBeNull();
  });

  it('conserva la reserva pendiente cuando M5 no está disponible', async () => {
    const repository = new InMemoryReservaRepository();
    const assignmentUnavailable: AsignacionClient = {
      asignar: async () => Promise.reject(new Error('M5 caído')),
      liberar: async () => undefined,
    };
    const service = new ReservaService(
      repository,
      { estimar: async () => ({ tarifaEstimada: 1_000, moneda: 'ARS' }) },
      assignmentUnavailable,
    );

    const reserva = await service.crear({
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(reserva.estado).toBe('PENDIENTE_ASIGNACION');
    expect(reserva.asignacion).toBeNull();
    expect(await repository.obtenerPorId(reserva.id)).not.toBeNull();
  });
});
