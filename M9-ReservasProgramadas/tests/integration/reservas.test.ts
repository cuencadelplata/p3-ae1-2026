import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { asignacionClientDemo } from '../helpers/asignacion.js';

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
  let estimarTarifa: ReturnType<typeof vi.fn<TarifaClient['estimar']>>;

  beforeEach(() => {
    repository = new InMemoryReservaRepository();
    estimarTarifa = vi.fn(async () => ({ tarifaEstimada: 3_250, moneda: 'ARS' }));
    app = createApp({
      reservaService: new ReservaService(
        repository,
        { estimar: estimarTarifa },
        asignacionClientDemo(),
      ),
    });
  });

  it('recalcula la tarifa al modificar origen, destino o vehículo', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    estimarTarifa.mockResolvedValueOnce({ tarifaEstimada: 4_800, moneda: 'ARS' });

    const actualizada = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ destino: 'Puerto', vehiculo: 'MOTO' });

    expect(actualizada.status).toBe(200);
    expect(actualizada.body).toMatchObject({
      destino: 'Puerto',
      vehiculo: 'MOTO',
      tarifaEstimada: 4_800,
      moneda: 'ARS',
    });
    expect(estimarTarifa).toHaveBeenLastCalledWith({
      origen: bodyValido().origen,
      destino: 'Puerto',
      vehiculo: 'MOTO',
    });
  });

  it('elimina la tarifa anterior si M7 falla al modificar el recorrido', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    estimarTarifa.mockRejectedValueOnce(new Error('M7 no disponible'));

    const actualizada = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ destino: 'Puerto' });

    expect(actualizada.status).toBe(200);
    expect(actualizada.body).toMatchObject({
      destino: 'Puerto',
      tarifaEstimada: null,
      moneda: 'ARS',
    });
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

    const modificada = await request(app).patch(`/reservas/${id}`).send({ destino: 'Puerto' });
    expect(modificada.status).toBe(200);
    expect(modificada.body.destino).toBe('Puerto');

    const cancelada = await request(app).delete(`/reservas/${id}`);
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.estado).toBe('CANCELADA');
  });

  it('lista reservas con paginación validada', async () => {
    await request(app).post('/reservas').send(bodyValido());
    await request(app).post('/reservas').send(bodyValido());

    const response = await request(app).get('/reservas?page=2&pageSize=1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 2, pageSize: 1 });
    expect(response.body.reservas).toHaveLength(1);
  });

  it('rechaza parámetros de paginación fuera de rango', async () => {
    const response = await request(app).get('/reservas?page=0&pageSize=101');

    expect(response.status).toBe(400);
    expect(response.body.error.codigo).toBe('DATOS_INVALIDOS');
  });

  it('responde 503 controlado si PostgreSQL no está disponible', async () => {
    const unavailableRepository = new InMemoryReservaRepository();
    unavailableRepository.listarPaginado = async () => {
      throw Object.assign(new Error('PostgreSQL no disponible'), { code: 'P1001' });
    };
    const serviceUnavailableApp = createApp({
      reservaService: new ReservaService(
        unavailableRepository,
        { estimar: estimarTarifa },
        asignacionClientDemo(),
      ),
    });

    const response = await request(serviceUnavailableApp).get('/reservas');

    expect(response.status).toBe(503);
    expect(response.body.error.codigo).toBe('BASE_DATOS_NO_DISPONIBLE');
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
