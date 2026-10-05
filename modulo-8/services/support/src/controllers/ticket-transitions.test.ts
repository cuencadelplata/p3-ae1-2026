import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository, type TicketStatus } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

let app: Express;
let repository: InMemoryTicketRepository;
let publish: ReturnType<typeof vi.fn<SupportEventPublisher['publish']>>;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  publish = vi.fn<SupportEventPublisher['publish']>(async () => undefined);
  app = createSupportApp({ ticketService: new TicketService(repository, { publish }), legacyEvents: false });
});

async function crearTicket(headers: Record<string, string> = {}) {
  const res = await request(app).post('/tickets').set(headers).send({ tripId: 'trip-1', motivo: 'Demora' });
  return res.body.id as string;
}

function cambiar(id: string, body: object, headers: Record<string, string> = {}) {
  return request(app).patch(`/tickets/${id}/estado`).set(headers).send(body);
}

// Lleva un ticket nuevo hasta el estado pedido por transiciones permitidas.
async function ticketEn(estado: TicketStatus) {
  const id = await crearTicket();
  if (estado !== 'ABIERTO') {
    await cambiar(id, { estado });
  }
  return id;
}

async function historial(id: string) {
  return (await request(app).get(`/tickets/${id}/historial`)).body;
}

describe('transiciones de estado', () => {
  it.each<[TicketStatus, TicketStatus]>([
    ['ABIERTO', 'EN_PROCESO'],
    ['ABIERTO', 'RESUELTO'],
    ['EN_PROCESO', 'ABIERTO'],
    ['EN_PROCESO', 'RESUELTO'],
  ])('permite %s → %s', async (desde, hacia) => {
    const id = await ticketEn(desde);

    const res = await cambiar(id, { estado: hacia });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe(hacia);
  });

  it('prohíbe RESUELTO → EN_PROCESO con 409 SUPPORT_INVALID_TRANSITION', async () => {
    const id = await ticketEn('RESUELTO');

    const res = await cambiar(id, { estado: 'EN_PROCESO', motivo: 'Aunque tenga motivo' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPORT_INVALID_TRANSITION');
    expect(res.body.error.details).toEqual([
      { field: 'estado', reason: 'No se permite pasar de RESUELTO a EN_PROCESO.' },
    ]);
    expect((await request(app).get(`/tickets/${id}`)).body.estado).toBe('RESUELTO');
  });

  it('una transición rechazada no deja historial ni publica evento', async () => {
    const id = await ticketEn('RESUELTO');
    const antes = await historial(id);
    publish.mockClear();

    await cambiar(id, { estado: 'EN_PROCESO' });

    expect(await historial(id)).toEqual(antes);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('reapertura RESUELTO → ABIERTO', () => {
  it.each([
    ['sin motivo', {}],
    ['con motivo vacío', { motivo: '' }],
    ['con motivo en blanco', { motivo: '   ' }],
  ])('la rechaza %s con SUPPORT_VALIDATION_ERROR', async (_caso, extra) => {
    const id = await ticketEn('RESUELTO');

    const res = await cambiar(id, { estado: 'ABIERTO', ...extra });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'motivo', reason: 'Reabrir un ticket resuelto requiere un motivo.' },
    ]);
    expect((await request(app).get(`/tickets/${id}`)).body.estado).toBe('RESUELTO');
  });

  it('la permite con motivo y lo deja en el historial', async () => {
    const id = await ticketEn('RESUELTO');

    const res = await cambiar(id, { estado: 'ABIERTO', motivo: 'El problema volvió a ocurrir' });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ABIERTO');
    const entradas = await historial(id);
    expect(entradas.at(-1)).toMatchObject({
      estadoAnterior: 'RESUELTO',
      estadoNuevo: 'ABIERTO',
      motivo: 'El problema volvió a ocurrir',
    });
  });

  it('rechaza un motivo que no es texto', async () => {
    const id = await ticketEn('ABIERTO');

    const res = await cambiar(id, { estado: 'EN_PROCESO', motivo: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'motivo', reason: 'Debe ser un texto.' }]);
  });
});

describe('cambio al mismo estado', () => {
  it.each<[TicketStatus]>([['ABIERTO'], ['EN_PROCESO'], ['RESUELTO']])(
    '%s → %s responde 200 sin historial ni evento',
    async (estado) => {
      const id = await ticketEn(estado);
      const antes = await historial(id);
      publish.mockClear();

      const res = await cambiar(id, { estado });

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe(estado);
      expect(await historial(id)).toEqual(antes);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it('repetir el mismo PATCH deja una sola entrada de historial y un solo evento', async () => {
    const id = await crearTicket();
    publish.mockClear();

    await cambiar(id, { estado: 'EN_PROCESO' });
    await cambiar(id, { estado: 'EN_PROCESO' });
    await cambiar(id, { estado: 'EN_PROCESO' });

    expect(await historial(id)).toHaveLength(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('eventos de tickets', () => {
  it('publica ticket.creado al crear y ticket.actualizado sólo en cambios reales', async () => {
    const id = await crearTicket();
    await cambiar(id, { estado: 'EN_PROCESO' });

    expect(publish.mock.calls.map(([evento]) => evento)).toEqual(['ticket.creado', 'ticket.actualizado']);
    expect(publish.mock.calls[1][1]).toMatchObject({ id, estado: 'EN_PROCESO' });
  });
});

describe('GET /tickets/:id/historial', () => {
  it('al crear el ticket registra una entrada inicial con estado anterior null', async () => {
    const id = await crearTicket();

    const res = await request(app).get(`/tickets/${id}/historial`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      ticketId: id,
      estadoAnterior: null,
      estadoNuevo: 'ABIERTO',
      cambiadoPor: null,
      motivo: null,
    });
    expect(new Date(res.body[0].fecha).toISOString()).toBe(res.body[0].fecha);
  });

  it('devuelve los cambios en orden cronológico', async () => {
    const id = await crearTicket();
    await cambiar(id, { estado: 'EN_PROCESO' });
    await cambiar(id, { estado: 'RESUELTO', motivo: 'Reintegro emitido' });
    await cambiar(id, { estado: 'ABIERTO', motivo: 'Reclamo reabierto' });

    const entradas = await historial(id);

    expect(entradas.map((e: { estadoAnterior: string | null; estadoNuevo: string }) => [e.estadoAnterior, e.estadoNuevo])).toEqual([
      [null, 'ABIERTO'],
      ['ABIERTO', 'EN_PROCESO'],
      ['EN_PROCESO', 'RESUELTO'],
      ['RESUELTO', 'ABIERTO'],
    ]);
    expect(entradas.map((e: { motivo: string | null }) => e.motivo)).toEqual([
      null,
      null,
      'Reintegro emitido',
      'Reclamo reabierto',
    ]);
    const fechas = entradas.map((e: { fecha: string }) => e.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it('registra quién hizo cada cambio a partir de X-Actor-Id, como string opaco', async () => {
    const id = await crearTicket({ 'X-Actor-Id': 'pasajero-77' });
    await cambiar(id, { estado: 'EN_PROCESO' }, { 'X-Actor-Id': 'agente/0042' });
    await cambiar(id, { estado: 'RESUELTO' });

    const entradas = await historial(id);

    expect(entradas.map((e: { cambiadoPor: string | null }) => e.cambiadoPor)).toEqual([
      'pasajero-77',
      'agente/0042',
      null,
    ]);
  });

  it('rechaza un X-Actor-Id de más de 255 caracteres', async () => {
    const id = await crearTicket();

    const res = await cambiar(id, { estado: 'EN_PROCESO' }, { 'X-Actor-Id': 'a'.repeat(256) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('X-Actor-Id');
  });

  it('no mezcla el historial de tickets distintos', async () => {
    const primero = await crearTicket();
    const segundo = await crearTicket();
    await cambiar(primero, { estado: 'EN_PROCESO' });

    expect(await historial(primero)).toHaveLength(2);
    expect(await historial(segundo)).toHaveLength(1);
  });

  it('responde 404 SUPPORT_TICKET_NOT_FOUND si el ticket no existe', async () => {
    const res = await request(app).get('/tickets/no-existe/historial');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUPPORT_TICKET_NOT_FOUND');
  });
});

describe('InMemoryTicketRepository: historial', () => {
  it('crear y actualizarEstado dejan el ticket y su entrada de historial juntos', async () => {
    const ticket = await repository.crear('trip-9', 'Demora', { actor: 'pasajero-1' });
    await repository.actualizarEstado(ticket.id, 'EN_PROCESO', { actor: 'agente-1', motivo: 'Tomado' });

    expect(await repository.listarHistorial(ticket.id)).toMatchObject([
      { estadoAnterior: null, estadoNuevo: 'ABIERTO', cambiadoPor: 'pasajero-1', motivo: null },
      { estadoAnterior: 'ABIERTO', estadoNuevo: 'EN_PROCESO', cambiadoPor: 'agente-1', motivo: 'Tomado' },
    ]);
  });

  it('no registra historial si el ticket no existe', async () => {
    expect(await repository.actualizarEstado('no-existe', 'RESUELTO')).toBeNull();
    expect(await repository.listarHistorial('no-existe')).toEqual([]);
  });

  it('devuelve copias: modificar un ticket leído no altera lo guardado', async () => {
    const ticket = await repository.crear('trip-10', 'Demora');
    ticket.estado = 'RESUELTO';

    expect((await repository.obtenerPorId(ticket.id))?.estado).toBe('ABIERTO');
  });
});
