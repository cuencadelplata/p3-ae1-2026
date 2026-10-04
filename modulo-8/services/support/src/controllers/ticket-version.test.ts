import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketVersionConflictError } from '../repositories/ticket.repository.js';
import { TicketService } from '../services/ticket.service.js';

let app: Express;
let repository: InMemoryTicketRepository;
let ticketService: TicketService;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  ticketService = new TicketService(repository, new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: false });
});

async function crearTicket() {
  return (await request(app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' })).body;
}

function cambiar(id: string, body: object) {
  return request(app).patch(`/tickets/${id}/estado`).send(body);
}

async function leer(id: string) {
  return (await request(app).get(`/tickets/${id}`)).body;
}

async function historial(id: string) {
  return (await request(app).get(`/tickets/${id}/historial`)).body;
}

describe('versión del ticket', () => {
  it('un ticket nuevo nace en la versión 1 y con fechaActualizacion igual a fechaCreacion', async () => {
    const ticket = await crearTicket();

    expect(ticket.version).toBe(1);
    expect(ticket.fechaActualizacion).toBe(ticket.fechaCreacion);
  });

  it('cada cambio de estado real sube la versión en uno', async () => {
    const { id, fechaCreacion } = await crearTicket();

    expect((await cambiar(id, { estado: 'EN_PROCESO' })).body.version).toBe(2);
    const resuelto = (await cambiar(id, { estado: 'RESUELTO' })).body;

    expect(resuelto.version).toBe(3);
    expect(resuelto.fechaCreacion).toBe(fechaCreacion);
    expect(resuelto.fechaActualizacion >= fechaCreacion).toBe(true);
  });

  it('el cambio al mismo estado no sube la versión', async () => {
    const { id } = await crearTicket();

    const res = await cambiar(id, { estado: 'ABIERTO' });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
  });

  it('una transición rechazada no sube la versión', async () => {
    const { id } = await crearTicket();
    await cambiar(id, { estado: 'RESUELTO' });

    await cambiar(id, { estado: 'EN_PROCESO' });

    expect((await leer(id)).version).toBe(2);
  });
});

describe('PATCH /tickets/:id/estado con expectedVersion', () => {
  it('aplica el cambio si la versión coincide', async () => {
    const { id } = await crearTicket();

    const res = await cambiar(id, { estado: 'EN_PROCESO', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'EN_PROCESO', version: 2 });
  });

  it('responde 409 SUPPORT_CONCURRENCY_CONFLICT si la versión no coincide, sin tocar el ticket', async () => {
    const { id } = await crearTicket();
    await cambiar(id, { estado: 'EN_PROCESO' });

    const res = await cambiar(id, { estado: 'RESUELTO', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');
    expect(await leer(id)).toMatchObject({ estado: 'EN_PROCESO', version: 2 });
    expect(await historial(id)).toHaveLength(2);
  });

  it('una versión que no coincide es conflicto aunque se pida el mismo estado', async () => {
    const { id } = await crearTicket();
    await cambiar(id, { estado: 'EN_PROCESO' });

    const res = await cambiar(id, { estado: 'EN_PROCESO', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');
  });

  it('dos actualizaciones con la misma expectedVersion: una 200 y otra 409', async () => {
    const { id } = await crearTicket();

    const respuestas = await Promise.all([
      cambiar(id, { estado: 'EN_PROCESO', expectedVersion: 1 }),
      cambiar(id, { estado: 'RESUELTO', expectedVersion: 1 }),
    ]);

    expect(respuestas.map((res) => res.status).sort()).toEqual([200, 409]);
    const rechazada = respuestas.find((res) => res.status === 409)!;
    const aceptada = respuestas.find((res) => res.status === 200)!;
    expect(rechazada.body.error.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');

    expect(await leer(id)).toMatchObject({ estado: aceptada.body.estado, version: 2 });
    expect(await historial(id)).toHaveLength(2);
  });

  it('sin expectedVersion sigue funcionando como en AE1', async () => {
    const { id } = await crearTicket();

    expect((await cambiar(id, { estado: 'EN_PROCESO' })).status).toBe(200);
    expect((await cambiar(id, { estado: 'RESUELTO' })).status).toBe(200);
  });

  it.each([
    ['cero', 0],
    ['negativo', -1],
    ['decimal', 1.5],
    ['un string', '1'],
    ['null', null],
    ['un booleano', true],
  ])('responde 400 si expectedVersion es %s', async (_caso, expectedVersion) => {
    const { id } = await crearTicket();

    const res = await cambiar(id, { estado: 'EN_PROCESO', expectedVersion });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'expectedVersion', reason: 'Debe ser un entero positivo.' }]);
    expect((await leer(id)).version).toBe(1);
  });
});

describe('TicketService: carrera entre dos cambios sin expectedVersion', () => {
  it('si ambos leyeron la misma versión, sólo uno se aplica', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');

    // Los dos pedidos leen el ticket (versión 1) antes de que ninguno escriba.
    let liberar!: () => void;
    const ambosLeyeron = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const obtenerPorId = repository.obtenerPorId.bind(repository);
    vi.spyOn(repository, 'obtenerPorId').mockImplementation(async (id) => {
      const leido = await obtenerPorId(id);
      await ambosLeyeron;
      return leido;
    });

    const cambios = Promise.allSettled([
      ticketService.actualizarEstado(ticket.id, 'EN_PROCESO'),
      ticketService.actualizarEstado(ticket.id, 'RESUELTO'),
    ]);
    liberar();
    const resultados = await cambios;

    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rechazado = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazado.reason.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');

    vi.restoreAllMocks();
    expect((await repository.obtenerPorId(ticket.id))?.version).toBe(2);
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(2);
  });
});

describe('InMemoryTicketRepository: actualización condicionada', () => {
  it('con la misma expectedVersion sólo se aplica una actualización', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');

    const resultados = await Promise.allSettled([
      repository.actualizarEstado(ticket.id, 'EN_PROCESO', { expectedVersion: 1 }),
      repository.actualizarEstado(ticket.id, 'RESUELTO', { expectedVersion: 1 }),
    ]);

    expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((resultados[1] as PromiseRejectedResult).reason).toBeInstanceOf(TicketVersionConflictError);
    expect(await repository.obtenerPorId(ticket.id)).toMatchObject({ estado: 'EN_PROCESO', version: 2 });
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(2);
  });

  it('un conflicto de versión no modifica el ticket ni su historial', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');

    await expect(repository.actualizarEstado(ticket.id, 'RESUELTO', { expectedVersion: 7 })).rejects.toBeInstanceOf(
      TicketVersionConflictError,
    );

    expect(await repository.obtenerPorId(ticket.id)).toMatchObject({ estado: 'ABIERTO', version: 1 });
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(1);
  });

  it('devuelve null si el ticket no existe, aun con expectedVersion', async () => {
    expect(await repository.actualizarEstado('no-existe', 'RESUELTO', { expectedVersion: 1 })).toBeNull();
  });
});
