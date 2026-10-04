import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { TarifaClient } from '../../src/clients/tarifa.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo } from '../helpers/route.js';

const bodyValido = () => ({
  clienteId: randomUUID(),
  origen: 'Terminal de Ómnibus',
  destino: 'Aeropuerto',
  vehiculo: 'AUTO',
  fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
});

describe('API /reservas', () => {
  let app: ReturnType<typeof createApp>;
  let estimarTarifa: ReturnType<typeof vi.fn<TarifaClient['estimar']>>;

  beforeEach(() => {
    estimarTarifa = vi.fn(async () => fareEstimate(3_250));
    app = createApp({
      reservaService: new ReservaService(
        new InMemoryReservaRepository(),
        { estimar: estimarTarifa },
        routeResolverDemo(),
      ),
    });
  });

  it('crea PROGRAMADA sin chofer ni solicitud M5 y guarda la estimación', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    expect(creada.status).toBe(201);
    expect(creada.body).toMatchObject({
      estado: 'PROGRAMADA',
      tarifaEstimada: 3_250,
      estimacionTarifaId: 'est_test',
      idSolicitud: null,
      assignedDriverId: null,
      routeSnapshot: { distanceKm: 10 },
    });
  });

  it('recalcula ruta/tarifa al cambiar recorrido o vehículo y no al cambiar solo fecha', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    estimarTarifa.mockResolvedValueOnce(fareEstimate(4_800));
    const actualizada = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ destino: 'Puerto', vehiculo: 'MOTO' });
    expect(actualizada.status).toBe(200);
    expect(actualizada.body).toMatchObject({
      destino: 'Puerto',
      vehiculo: 'MOTO',
      tarifaEstimada: 4_800,
    });
    expect(estimarTarifa).toHaveBeenCalledTimes(2);

    const nuevaFecha = new Date(Date.now() + 7_200_000).toISOString();
    await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ fechaHoraProgramada: nuevaFecha });
    expect(estimarTarifa).toHaveBeenCalledTimes(2);
  });

  it('elimina tarifa y ruta anteriores si la nueva consulta externa falla', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    estimarTarifa.mockRejectedValueOnce(new Error('M7 no disponible'));
    const actualizada = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ destino: 'Puerto' });
    expect(actualizada.body).toMatchObject({
      destino: 'Puerto',
      tarifaEstimada: null,
      routeSnapshot: null,
    });
  });

  it('consulta, lista, modifica y cancela lógicamente', async () => {
    const creada = await request(app).post('/reservas').send(bodyValido());
    const id = creada.body.id as string;
    expect((await request(app).get(`/reservas/${id}`)).status).toBe(200);
    expect((await request(app).get('/reservas')).body.reservas).toHaveLength(1);
    expect((await request(app).patch(`/reservas/${id}`).send({ destino: 'Puerto' })).status).toBe(
      200,
    );
    expect((await request(app).delete(`/reservas/${id}`)).body.estado).toBe('CANCELADA');
  });

  it('rechaza fecha pasada, campos de servidor y operaciones sobre estado final', async () => {
    const pasada = await request(app)
      .post('/reservas')
      .send({ ...bodyValido(), fechaHoraProgramada: new Date(0).toISOString() });
    expect(pasada.body.error.codigo).toBe('FECHA_INVALIDA');
    const forzada = await request(app)
      .post('/reservas')
      .send({ ...bodyValido(), estado: 'ACTIVADA' });
    expect(forzada.body.error.codigo).toBe('DATOS_INVALIDOS');
    const creada = await request(app).post('/reservas').send(bodyValido());
    await request(app).delete(`/reservas/${creada.body.id as string}`);
    expect(
      (
        await request(app)
          .patch(`/reservas/${creada.body.id as string}`)
          .send({ destino: 'Puerto' })
      ).status,
    ).toBe(409);
    expect((await request(app).delete(`/reservas/${creada.body.id as string}`)).status).toBe(409);
  });

  it('distingue una reserva inexistente', async () => {
    const response = await request(app).get(`/reservas/${randomUUID()}`);
    expect(response.status).toBe(404);
    expect(response.body.error.codigo).toBe('RESERVA_NO_ENCONTRADA');
  });
});
