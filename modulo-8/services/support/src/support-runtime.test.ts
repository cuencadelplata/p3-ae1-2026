import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSupportConfig } from './config/env.js';

const amqpMock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpMock.connect }));

function fakeChannel() {
  return {
    on: vi.fn(),
    assertExchange: vi.fn(async () => undefined),
    assertQueue: vi.fn(async () => undefined),
    bindQueue: vi.fn(async () => undefined),
    prefetch: vi.fn(async () => undefined),
    consume: vi.fn(async () => ({ consumerTag: 'test' })),
    publish: vi.fn((_exchange: string, _routingKey: string, _content: Buffer) => true),
    ack: vi.fn(),
  };
}

describe('loadSupportConfig', () => {
  it('habilita lo heredado de AE1 por defecto', () => {
    expect(loadSupportConfig({}).legacyEvents).toBe(true);
    expect(loadSupportConfig({ SUPPORT_LEGACY_EVENTS: 'on' }).legacyEvents).toBe(true);
  });

  it('lo deshabilita con SUPPORT_LEGACY_EVENTS=off', () => {
    expect(loadSupportConfig({ SUPPORT_LEGACY_EVENTS: 'off' }).legacyEvents).toBe(false);
  });

  it('rechaza un valor desconocido en lugar de asumir uno', () => {
    expect(() => loadSupportConfig({ SUPPORT_LEGACY_EVENTS: 'true' })).toThrow(/SUPPORT_LEGACY_EVENTS/);
  });

  it('conserva los valores por defecto de puerto y broker', () => {
    expect(loadSupportConfig({})).toMatchObject({ port: 3000, rabbitUrl: 'amqp://localhost:5672' });
  });
});

describe('createSupportRuntime', () => {
  let channel: ReturnType<typeof fakeChannel>;

  // El consumer guarda su estado en campos estáticos: cada test usa módulos nuevos.
  async function loadRuntime(legacyEvents: boolean) {
    const { createSupportRuntime } = await import('./support-runtime.js');
    const { InMemoryTicketRepository } = await import('./models/ticket.model.js');
    const config = { port: 0, rabbitUrl: 'amqp://test', legacyEvents };
    return createSupportRuntime(config, new InMemoryTicketRepository());
  }

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    channel = fakeChannel();
    amqpMock.connect.mockReset();
    amqpMock.connect.mockImplementation(async () => ({
      on: vi.fn(),
      createChannel: vi.fn(async () => channel),
      close: vi.fn(async () => undefined),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('con SUPPORT_LEGACY_EVENTS=off', () => {
    it('no se conecta al broker y los tickets funcionan', async () => {
      const runtime = await loadRuntime(false);
      await runtime.startLegacyEvents();

      expect(amqpMock.connect).not.toHaveBeenCalled();

      const created = await request(runtime.app).post('/tickets').send({ viajeId: 'viaje-off', motivo: 'Demora' });
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
      expect(channel.publish).not.toHaveBeenCalled();
    });

    it('no expone POST /events/publish', async () => {
      const runtime = await loadRuntime(false);

      const res = await request(runtime.app)
        .post('/events/publish')
        .send({ routingKey: 'viaje.completado', payload: { viajeId: 'v-1' } });

      expect(res.status).toBe(404);
    });
  });

  describe('con SUPPORT_LEGACY_EVENTS=on', () => {
    it('conecta el consumer legacy al broker configurado', async () => {
      const runtime = await loadRuntime(true);
      await runtime.startLegacyEvents();

      expect(amqpMock.connect).toHaveBeenCalledTimes(1);
      expect(amqpMock.connect).toHaveBeenCalledWith('amqp://test');
    });

    it('publica ticket.creado y ticket.actualizado con el ticket, como en AE1', async () => {
      const runtime = await loadRuntime(true);
      await runtime.startLegacyEvents();

      const created = await request(runtime.app).post('/tickets').send({ viajeId: 'viaje-on', motivo: 'Demora' });
      const updated = await request(runtime.app)
        .patch(`/tickets/${created.body.id}/estado`)
        .send({ estado: 'EN_PROCESO' });

      expect(channel.publish).toHaveBeenCalledTimes(2);
      const [first, second] = channel.publish.mock.calls;

      expect(first[0]).toBe('viajes_exchange');
      expect(first[1]).toBe('ticket.creado');
      expect(JSON.parse(first[2].toString())).toEqual({ ...created.body, estado: 'ABIERTO' });

      expect(second[0]).toBe('viajes_exchange');
      expect(second[1]).toBe('ticket.actualizado');
      expect(JSON.parse(second[2].toString())).toEqual(updated.body);
    });

    it('no publica ticket.actualizado si el ticket no existe', async () => {
      const runtime = await loadRuntime(true);
      await runtime.startLegacyEvents();

      const res = await request(runtime.app).patch('/tickets/inexistente/estado').send({ estado: 'RESUELTO' });

      expect(res.status).toBe(404);
      expect(channel.publish).not.toHaveBeenCalled();
    });

    it('expone POST /events/publish', async () => {
      const runtime = await loadRuntime(true);
      await runtime.startLegacyEvents();

      const res = await request(runtime.app)
        .post('/events/publish')
        .send({ routingKey: 'viaje.completado', payload: { viajeId: 'v-1' } });

      expect(res.status).toBe(200);
      expect(res.body.enviadosExitosamente).toBe(1);
    });
  });
});
