import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { HttpAsignacionClient } from '../../src/clients/asignacion.client.js';
import { HttpDespachoClient } from '../../src/clients/despacho.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';
import { ReservasScheduler } from '../../src/jobs/reservas.scheduler.js';
import { CHOFERES_DEMO, createM5StubApp, type ChoferStub } from '../../src/stubs/m5/app.js';
import type { CrearReserva } from '../../src/domain/reserva.js';

const input = (hours = 2, vehiculo: 'AUTO' | 'MOTO' = 'AUTO'): CrearReserva => ({
  clienteId: randomUUID(),
  origen: 'Terminal',
  destino: 'Aeropuerto',
  vehiculo,
  fechaHoraProgramada: new Date(Date.now() + hours * 3_600_000).toISOString(),
});

describe('asignación de chofer desde la creación con M5 HTTP', () => {
  let server: Server;
  let repository: InMemoryReservaRepository;
  let service: ReservaService;
  let client: HttpAsignacionClient;
  let despacho: HttpDespachoClient;
  let scheduler: ReservasScheduler;
  let conductores: ChoferStub[];

  beforeEach(async () => {
    conductores = CHOFERES_DEMO.map((c) => ({ ...c }));
    server = await new Promise<Server>((resolve) => {
      const started = createM5StubApp(conductores).listen(0, () => resolve(started));
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    repository = new InMemoryReservaRepository();
    client = new HttpAsignacionClient(url);
    despacho = new HttpDespachoClient(url);
    service = new ReservaService(
      repository,
      { estimar: async () => ({ tarifaEstimada: 2500, moneda: 'ARS' }) },
      client,
    );
    scheduler = new ReservasScheduler(
      repository,
      new ActivacionReservaService(repository, despacho),
      '* * * * * *',
      vi.fn(),
      service,
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('crea con el chofer apto de mayor valoración y bloquea la asignación desde la API', async () => {
    const app = createApp({ reservaService: service });
    const response = await request(app).post('/reservas').send(input());
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      estado: 'PROGRAMADA',
      asignacion: { choferId: CHOFERES_DEMO[0]!.id, valoracion: 4.9 },
    });
    expect(
      (
        await request(app)
          .patch(`/reservas/${response.body.id as string}`)
          .send({ asignacion: null })
      ).status,
    ).toBe(400);
  });

  it('evita solapamientos, deja pendiente sin disponibilidad y permite otro horario', async () => {
    const viaje = input();
    const [a, b, c] = await Promise.all([
      service.crear(viaje),
      service.crear(viaje),
      service.crear(viaje),
    ]);
    expect(new Set([a.asignacion?.choferId, b.asignacion?.choferId]).size).toBe(2);
    expect(c).toMatchObject({ estado: 'PENDIENTE_ASIGNACION', asignacion: null });
    const otroHorario = await service.crear(input(4));
    expect(otroHorario.asignacion?.choferId).toBe(CHOFERES_DEMO[0]!.id);
  });

  it('reintenta pendientes mediante scheduler después de liberar un chofer', async () => {
    const viaje = input(2, 'MOTO');
    const primera = await service.crear(viaje);
    const pendiente = await service.crear(viaje);
    expect(pendiente.estado).toBe('PENDIENTE_ASIGNACION');
    await service.cancelar(primera.id);
    await scheduler.ejecutar();
    expect(await service.obtenerPorId(pendiente.id)).toMatchObject({
      estado: 'PROGRAMADA',
      asignacion: { choferId: CHOFERES_DEMO[2]!.id },
    });
  });

  it('reevalúa vehículo, recorrido y horario; conserva al chofer si sigue siendo el mejor', async () => {
    const creada = await service.crear(input());
    const recorrido = await service.actualizar(creada.id, { destino: 'Puerto' });
    expect(recorrido.asignacion?.choferId).toBe(creada.asignacion?.choferId);
    expect(recorrido.asignacion?.id).not.toBe(creada.asignacion?.id);
    const historyResponse = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/asignaciones/${creada.id}/ofertas`,
    );
    const ofertas = (await historyResponse.json()) as { ofertas: { estado: string }[] };
    expect(ofertas.ofertas.filter((o) => o.estado === 'ACEPTADA')).toHaveLength(2);
    const moto = await service.actualizar(creada.id, { vehiculo: 'MOTO' });
    expect(moto.asignacion?.choferId).toBe(CHOFERES_DEMO[2]!.id);
    const ocupada = await service.crear(input(5, 'MOTO'));
    const pendiente = await service.actualizar(moto.id, {
      fechaHoraProgramada: ocupada.fechaHoraProgramada,
    });
    expect(pendiente).toMatchObject({ estado: 'PENDIENTE_ASIGNACION', asignacion: null });
    const libre = await service.crear(input(2, 'MOTO'));
    expect(libre.estado).toBe('PROGRAMADA');
    const editada = await service.actualizar(pendiente.id, {
      fechaHoraProgramada: input(8).fechaHoraProgramada,
    });
    expect(editada.estado).toBe('PROGRAMADA');
  });

  it('el CRUD cambia al chofer si el anterior rechaza, queda pendiente si nadie acepta y reintenta', async () => {
    const app = createApp({ reservaService: service });
    const creada = await request(app).post('/reservas').send(input());
    expect(creada.body.asignacion.choferId).toBe(conductores[0]!.id);
    conductores[0]!.respuestaSimulada = 'RECHAZAR';
    const editada = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ destino: 'Puerto' });
    expect(editada.status).toBe(200);
    expect(editada.body.asignacion.choferId).toBe(conductores[1]!.id);
    expect(editada.body.asignacion.id).not.toBe(creada.body.asignacion.id);
    conductores[1]!.respuestaSimulada = 'RECHAZAR';
    const pendiente = await request(app)
      .patch(`/reservas/${creada.body.id as string}`)
      .send({ origen: 'Campus' });
    expect(pendiente.body).toMatchObject({ estado: 'PENDIENTE_ASIGNACION', asignacion: null });
    conductores[0]!.respuestaSimulada = 'ACEPTAR';
    await scheduler.ejecutar();
    expect(await service.obtenerPorId(creada.body.id as string)).toMatchObject({
      estado: 'PROGRAMADA',
      asignacion: { choferId: conductores[0]!.id },
    });
    expect((await request(app).delete(`/reservas/${creada.body.id as string}`)).body).toMatchObject(
      { estado: 'CANCELADA', asignacion: null },
    );
  });

  it('permite cancelar pendientes sin eliminar otras asignaciones', async () => {
    const primera = await service.crear(input(2, 'MOTO'));
    const segunda = await service.crear(input(2, 'MOTO'));
    expect((await service.cancelar(segunda.id)).estado).toBe('CANCELADA');
    expect((await service.obtenerPorId(primera.id)).asignacion).toEqual(primera.asignacion);
  });

  it('mantiene pendiente una reserva cuyo horario llegó sin chofer', async () => {
    const pendiente = await repository.crear({
      ...input(),
      fechaHoraProgramada: new Date(0).toISOString(),
    });
    const asignar = vi.spyOn(client, 'asignar');
    const enviar = vi.spyOn(despacho, 'crearSolicitud');
    await scheduler.ejecutar();
    await new ActivacionReservaService(repository, despacho).activar(pendiente.id);
    expect(asignar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect((await service.obtenerPorId(pendiente.id)).estado).toBe('PENDIENTE_ASIGNACION');
  });

  it('activa utilizando la asignación vigente y M5 responde idempotentemente', async () => {
    const creada = await service.crear(input());
    const vencida = { ...creada, fechaHoraProgramada: new Date(Date.now() - 1000).toISOString() };
    vencida.asignacion = await client.asignar(vencida);
    await repository.actualizarProgramada(creada.id, {
      fechaHoraProgramada: vencida.fechaHoraProgramada,
      asignacion: vencida.asignacion,
    });
    await scheduler.ejecutar();
    const activada = await service.obtenerPorId(creada.id);
    expect(activada.estado).toBe('ACTIVADA');
    expect(activada.asignacion).toEqual(vencida.asignacion);
    expect((await despacho.crearSolicitud(activada)).solicitudId).toBe(activada.idSolicitud);
    await expect(client.liberar(creada.id)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('no despacha un recorrido con asignación obsoleta', async () => {
    const creada = await service.crear(input());
    await expect(
      despacho.crearSolicitud({ ...creada, destino: 'Otro destino' }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('serializa cancelación y edición durante una asignación lenta', async () => {
    const creada = await service.crear(input());
    const original = client.asignar.bind(client);
    let liberar!: () => void;
    let iniciado!: () => void;
    const bloqueo = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const inicio = new Promise<void>((resolve) => {
      iniciado = resolve;
    });
    vi.spyOn(client, 'asignar').mockImplementationOnce(async (reserva) => {
      iniciado();
      await bloqueo;
      return original(reserva);
    });
    const edicion = service.actualizar(creada.id, { destino: 'Puerto' });
    await inicio;
    const cancelacion = service.cancelar(creada.id);
    liberar();
    await Promise.all([edicion, cancelacion]);
    expect(await service.obtenerPorId(creada.id)).toMatchObject({
      estado: 'CANCELADA',
      asignacion: null,
    });
    expect((await service.crear(input())).asignacion?.choferId).toBe(CHOFERES_DEMO[0]!.id);
  });

  it('guarda pendiente cuando M5 falla y rechaza edición/cancelación si no confirma liberación', async () => {
    const app = createApp({ reservaService: service });
    vi.spyOn(client, 'asignar').mockRejectedValueOnce(new Error('M5 caído'));
    const creada = await service.crear(input());
    expect(creada.estado).toBe('PENDIENTE_ASIGNACION');
    await service.reintentarAsignacion(creada.id);
    vi.spyOn(client, 'liberar').mockRejectedValue(
      new (await import('../../src/errors/app.error.js')).AppError(
        503,
        'SERVICIO_EXTERNO_NO_DISPONIBLE',
        'M5 caído',
      ),
    );
    expect(
      (await request(app).patch(`/reservas/${creada.id}`).send({ destino: 'Puerto' })).status,
    ).toBe(503);
    expect((await request(app).delete(`/reservas/${creada.id}`)).status).toBe(503);
    expect(await service.obtenerPorId(creada.id)).toMatchObject({
      estado: 'PROGRAMADA',
      destino: 'Aeropuerto',
    });
  });
});
