import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSupportConfig } from './config/env.js';
import { createSupportRuntime } from './support-runtime.js';
import { InMemoryTicketRepository } from './models/ticket.model.js';

const amqpMock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpMock.connect }));

describe('loadSupportConfig', () => {
  it('usa el puerto 3000 por defecto y respeta PORT', () => {
    expect(loadSupportConfig({})).toEqual({ port: 3000 });
    expect(loadSupportConfig({ PORT: '4100' })).toEqual({ port: '4100' });
  });
});

describe('createSupportRuntime', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    amqpMock.connect.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('los tickets funcionan sin conectarse a RabbitMQ', async () => {
    const runtime = createSupportRuntime({ port: 0 }, new InMemoryTicketRepository());

    const created = await request(runtime.app).post('/tickets').send({ viajeId: 'viaje-1', motivo: 'Demora' });
    expect(created.status).toBe(201);
    expect(created.body.estado).toBe('ABIERTO');

    const found = await request(runtime.app).get(`/tickets/${created.body.id}`);
    expect(found.status).toBe(200);

    const updated = await request(runtime.app)
      .patch(`/tickets/${created.body.id}/estado`)
      .send({ estado: 'RESUELTO' });
    expect(updated.status).toBe(200);
    expect(updated.body.estado).toBe('RESUELTO');

    const listed = await request(runtime.app).get('/tickets');
    expect(listed.body).toHaveLength(1);

    expect(amqpMock.connect).not.toHaveBeenCalled();
  });

  it('no expone la ruta POST /events/publish de AE1', async () => {
    const runtime = createSupportRuntime({ port: 0 }, new InMemoryTicketRepository());

    const res = await request(runtime.app)
      .post('/events/publish')
      .send({ routingKey: 'viaje.completado', payload: { viajeId: 'v-1' } });

    expect(res.status).toBe(404);
  });
});
