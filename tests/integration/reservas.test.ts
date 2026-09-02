import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';

const tarifaClient: TarifaClient = {
  estimar: async () => ({ tarifaEstimada: 3_250, moneda: 'ARS' }),
};

const bodyValido = () => ({
  clienteId: randomUUID(),
  origen: 'Terminal de Ómnibus',
  destino: 'Aeropuerto',
  vehiculo: 'AUTO',
  fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
});

describe('API /reservas', () => {
  let repository: InMemoryReservaRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryReservaRepository();
    app = createApp({ reservaService: new ReservaService(repository, tarifaClient) });
  });

  it('crea, consulta, lista, modifica y cancela lógicamente una reserva', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    expect(creada.status).toBe(201);
    expect(creada.body).toMatchObject({ estado: 'PROGRAMADA', tarifaEstimada: 3_250 });

    const id = creada.body.id as string;
    const consulta = await request(app).get(`/reservas/${id}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body.id).toBe(id);

    const listado = await request(app).get('/reservas');
    expect(listado.body.reservas).toHaveLength(1);

    const modificada = await request(app)
      .patch(`/reservas/${id}`)
      .send({ destino: 'Puerto' });
    expect(modificada.status).toBe(200);
    expect(modificada.body.destino).toBe('Puerto');

    const cancelada = await request(app).delete(`/reservas/${id}`);
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.estado).toBe('CANCELADA');
  });

  it('rechaza fechas pasadas con FECHA_INVALIDA', async () => {
    const response = await request(app)
      .post('/reservas')
      .send({ ...bodyValido(), fechaHoraProgramada: new Date(0).toISOString() });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        codigo: 'FECHA_INVALIDA',
        mensaje: 'La fecha y hora programada debe ser válida y futura.',
      },
    });
  });

  it('impide que el cliente fuerce estados', async () => {
    const response = await request(app)
      .post('/reservas')
      .send({ ...bodyValido(), estado: 'ACTIVADA' });

    expect(response.status).toBe(400);
    expect(response.body.error.codigo).toBe('DATOS_INVALIDOS');
  });

  it('distingue reserva inexistente y reserva no modificable/cancelable', async () => {
    const inexistente = await request(app).get(`/reservas/${randomUUID()}`);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe('RESERVA_NO_ENCONTRADA');

    const creada = await request(app).post('/reservas').send(bodyValido());
    const id = creada.body.id as string;
    await request(app).delete(`/reservas/${id}`);

    const modificacion = await request(app).patch(`/reservas/${id}`).send({ destino: 'Puerto' });
    expect(modificacion.status).toBe(409);
    expect(modificacion.body.error.codigo).toBe('RESERVA_NO_MODIFICABLE');

    const cancelacion = await request(app).delete(`/reservas/${id}`);
    expect(cancelacion.status).toBe(409);
    expect(cancelacion.body.error.codigo).toBe('RESERVA_NO_CANCELABLE');
  });
});
