import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { InMemoryReservaRepository } from '../support/in-memory-reserva.repository.js';

describe('ReservaService', () => {
  it('crea la reserva sin tarifa cuando M7 no está disponible', async () => {
    const repository = new InMemoryReservaRepository();
    const unavailableClient: TarifaClient = {
      estimar: async () => Promise.reject(new Error('M7 caído')),
    };
    const service = new ReservaService(repository, unavailableClient);

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
});
