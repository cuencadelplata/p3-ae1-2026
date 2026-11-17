import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';

describe('InMemoryReservaRepository', () => {
  it('permite un solo cambio de estado concurrente', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await repository.crear({
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
    });

    const resultados = await Promise.all([
      repository.cambiarEstado(reserva.id, 'PROGRAMADA', 'ACTIVANDO'),
      repository.cambiarEstado(reserva.id, 'PROGRAMADA', 'ACTIVANDO'),
    ]);

    expect(resultados.filter((resultado) => resultado !== null)).toHaveLength(1);
    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('ACTIVANDO');
  });

  it('devuelve copias para impedir cambios externos al estado almacenado', async () => {
    const repository = new InMemoryReservaRepository();
    const reserva = await repository.crear({
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'MOTO',
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
    });

    reserva.estado = 'CANCELADA';

    expect((await repository.obtenerPorId(reserva.id))?.estado).toBe('PROGRAMADA');
  });
});
