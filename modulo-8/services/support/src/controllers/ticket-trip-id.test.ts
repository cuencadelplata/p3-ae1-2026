import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

let app: Express;

beforeEach(() => {
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: false });
});

function crear(body: unknown) {
  return request(app).post('/tickets').send(body as object);
}

describe('POST /tickets: tripId y alias viajeId', () => {
  it('acepta tripId y devuelve tripId y viajeId con el mismo valor', async () => {
    const res = await crear({ tripId: 'trip-1', motivo: 'Demora' });

    expect(res.status).toBe(201);
    expect(res.body.tripId).toBe('trip-1');
    expect(res.body.viajeId).toBe('trip-1');
  });

  it('acepta viajeId como alias deprecado y devuelve también tripId', async () => {
    const res = await crear({ viajeId: 'viaje-1', motivo: 'Demora' });

    expect(res.status).toBe(201);
    expect(res.body.tripId).toBe('viaje-1');
    expect(res.body.viajeId).toBe('viaje-1');
  });

  it('acepta tripId y viajeId juntos si son iguales', async () => {
    const res = await crear({ tripId: 'trip-2', viajeId: 'trip-2', motivo: 'Demora' });

    expect(res.status).toBe(201);
    expect(res.body.tripId).toBe('trip-2');
  });

  it('rechaza tripId y viajeId distintos', async () => {
    const res = await crear({ tripId: 'trip-3', viajeId: 'otro', motivo: 'Demora' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('trata el id como string opaco: no lo recorta ni lo interpreta', async () => {
    const res = await crear({ tripId: ' 00123-ÁB/c ', motivo: 'Demora' });

    expect(res.status).toBe(201);
    expect(res.body.tripId).toBe(' 00123-ÁB/c ');
  });

  it.each([
    ['un número', 123],
    ['un objeto', { id: 'trip-4' }],
    ['un arreglo', ['trip-4']],
    ['un booleano', true],
    ['null', null],
    ['un string vacío', ''],
    ['un string en blanco', '   '],
  ])('rechaza tripId cuando es %s, sin convertirlo', async (_caso, tripId) => {
    const res = await crear({ tripId, motivo: 'Demora' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it.each([
    ['un número', 123],
    ['un objeto', { id: 'viaje-4' }],
    ['un string vacío', ''],
  ])('rechaza viajeId cuando es %s, sin convertirlo', async (_caso, viajeId) => {
    const res = await crear({ viajeId, motivo: 'Demora' });

    expect(res.status).toBe(400);
  });

  it('rechaza un viajeId inválido aunque tripId sea válido', async () => {
    const res = await crear({ tripId: 'trip-5', viajeId: 5, motivo: 'Demora' });

    expect(res.status).toBe(400);
  });

  it.each([
    ['un número', 42],
    ['un string en blanco', '  '],
    ['un objeto', {}],
  ])('rechaza motivo cuando es %s', async (_caso, motivo) => {
    const res = await crear({ tripId: 'trip-6', motivo });

    expect(res.status).toBe(400);
  });

  it('responde 400 si no se envía cuerpo', async () => {
    const res = await request(app).post('/tickets');

    expect(res.status).toBe(400);
  });

  it('no crea ningún ticket cuando la validación falla', async () => {
    await crear({ tripId: 123, motivo: 'Demora' });
    await crear({ tripId: 'a', viajeId: 'b', motivo: 'Demora' });

    const res = await request(app).get('/tickets');
    expect(res.body).toEqual([]);
  });

  it('las consultas posteriores devuelven tripId y viajeId', async () => {
    const created = await crear({ tripId: 'trip-7', motivo: 'Demora' });

    const found = await request(app).get(`/tickets/${created.body.id}`);
    expect(found.body.tripId).toBe('trip-7');
    expect(found.body.viajeId).toBe('trip-7');

    const updated = await request(app).patch(`/tickets/${created.body.id}/estado`).send({ estado: 'EN_PROCESO' });
    expect(updated.body.tripId).toBe('trip-7');
    expect(updated.body.viajeId).toBe('trip-7');
  });
});
