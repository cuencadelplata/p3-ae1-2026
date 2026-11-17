import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: Express;
let repository: InMemoryTicketRepository;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  const ticketService = new TicketService(repository, new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formato de error de Support', () => {
  it('ticket inexistente: 404 SUPPORT_TICKET_NOT_FOUND con correlationId', async () => {
    const res = await request(app).get('/tickets/no-existe');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'SUPPORT_TICKET_NOT_FOUND', message: 'Ticket no encontrado.' },
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('PATCH sobre un ticket inexistente: 404 SUPPORT_TICKET_NOT_FOUND', async () => {
    const res = await request(app).patch('/tickets/no-existe/estado').send({ estado: 'RESUELTO' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUPPORT_TICKET_NOT_FOUND');
  });

  it('validación: 400 SUPPORT_VALIDATION_ERROR con un detalle por campo', async () => {
    const res = await request(app).post('/tickets').send({ tripId: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.message).toBe('La solicitud contiene datos inválidos.');
    expect(res.body.error.details).toEqual([
      { field: 'tripId', reason: 'Debe ser un texto no vacío.' },
      { field: 'motivo', reason: 'Debe ser un texto no vacío.' },
    ]);
  });

  it('tripId y viajeId distintos: SUPPORT_VALIDATION_ERROR sobre viajeId', async () => {
    const res = await request(app).post('/tickets').send({ tripId: 'a', viajeId: 'b', motivo: 'Demora' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'viajeId', reason: 'No coincide con tripId.' }]);
  });

  it('falta el id del viaje: el detalle nombra tripId', async () => {
    const res = await request(app).post('/tickets').send({ motivo: 'Demora' });

    expect(res.body.error.details).toEqual([{ field: 'tripId', reason: 'Es requerido.' }]);
  });

  it('estado fuera del enum: SUPPORT_VALIDATION_ERROR sobre estado', async () => {
    const created = await request(app).post('/tickets').send({ tripId: 't-1', motivo: 'Demora' });

    const res = await request(app).patch(`/tickets/${created.body.id}/estado`).send({ estado: 'CERRADO' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('estado');
  });

  it('JSON malformado: 400 SUPPORT_VALIDATION_ERROR, no 500', async () => {
    const res = await request(app)
      .post('/tickets')
      .set('Content-Type', 'application/json')
      .send('{"tripId": "t-1", ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'body', reason: 'El JSON no es válido.' }]);
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('error no esperado: 500 SUPPORT_INTERNAL_ERROR genérico, sin stack en la respuesta', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repository, 'obtenerPorId').mockRejectedValue(new Error('detalle interno: tabla support.tickets'));

    const res = await request(app).get('/tickets/cualquiera').set('X-Correlation-Id', 'corr-500');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'SUPPORT_INTERNAL_ERROR', message: 'No fue posible procesar la solicitud.' },
      correlationId: 'corr-500',
    });
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
    expect(JSON.stringify(res.body)).not.toContain('stack');

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [, logged] = consoleError.mock.calls[0];
    expect(logged.correlationId).toBe('corr-500');
    expect(logged.stack).toContain('detalle interno: tabla support.tickets');
  });

  it('un error previsible no se registra como error no controlado', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(app).get('/tickets/no-existe');

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('correlationId', () => {
  it('usa el X-Correlation-Id recibido y lo devuelve como cabecera', async () => {
    const res = await request(app).get('/tickets/no-existe').set('X-Correlation-Id', 'trip-42');

    expect(res.headers['x-correlation-id']).toBe('trip-42');
    expect(res.body.correlationId).toBe('trip-42');
  });

  it('genera uno si no viene', async () => {
    const res = await request(app).get('/tickets/no-existe');

    expect(res.headers['x-correlation-id']).toMatch(UUID);
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('genera uno nuevo si el recibido no es válido', async () => {
    const res = await request(app).get('/tickets/no-existe').set('X-Correlation-Id', 'con espacios y <tags>');

    expect(res.headers['x-correlation-id']).toMatch(UUID);
  });

  it('se devuelve también en las respuestas exitosas', async () => {
    const created = await request(app)
      .post('/tickets')
      .set('X-Correlation-Id', 'corr-ok')
      .send({ tripId: 't-1', motivo: 'Demora' });
    expect(created.status).toBe(201);
    expect(created.headers['x-correlation-id']).toBe('corr-ok');

    const listed = await request(app).get('/tickets');
    expect(listed.headers['x-correlation-id']).toMatch(UUID);
  });

  it('se devuelve en /health y en la ruta legacy de eventos', async () => {
    const health = await request(app).get('/health');
    expect(health.headers['x-correlation-id']).toMatch(UUID);

    const published = await request(app)
      .post('/events/publish')
      .send({ routingKey: 'viaje.completado', payload: { viajeId: 'v-1' } });
    expect(published.headers['x-correlation-id']).toMatch(UUID);
  });
});

describe('registerSupportRoutes en una app ajena', () => {
  it('lleva consigo el correlationId y el formato de error de /tickets', async () => {
    const express = (await import('express')).default;
    const { registerSupportRoutes } = await import('../app.js');
    const host = express();
    host.use(express.json());
    registerSupportRoutes(host, {
      ticketService: new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher()),
      legacyEvents: false,
    });

    const res = await request(host).get('/tickets/no-existe');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUPPORT_TICKET_NOT_FOUND');
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });
});
