import { EventEmitter } from 'node:events';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const amqpMock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpMock.connect }));

type Handler = (msg: unknown) => Promise<void>;

class FakeChannel extends EventEmitter {
  handler: Handler | null = null;
  assertExchange = vi.fn(async () => undefined);
  assertQueue = vi.fn(async () => undefined);
  bindQueue = vi.fn(async () => undefined);
  prefetch = vi.fn(async () => undefined);
  publish = vi.fn(() => true);
  ack = vi.fn();
  consume = vi.fn(async (_queue: string, handler: Handler) => {
    this.handler = handler;
    return { consumerTag: 'test' };
  });
}

class FakeConnection extends EventEmitter {
  channel = new FakeChannel();
  createChannel = vi.fn(async () => this.channel);
  close = vi.fn(async () => undefined);
}

function message(routingKey: string, content: string) {
  return { content: Buffer.from(content), fields: { routingKey } };
}

function channelClosedError() {
  return Object.assign(new Error('Channel closed'), { name: 'IllegalOperationError' });
}

// Simula la caída del broker: amqplib cierra primero el canal y luego la conexión.
function dropBroker(connection: FakeConnection) {
  connection.channel.ack.mockImplementation(() => {
    throw channelClosedError();
  });
  connection.channel.publish.mockImplementation(() => {
    throw channelClosedError();
  });
  connection.emit('error', new Error('CONNECTION_FORCED'));
  connection.channel.emit('close');
  connection.emit('close');
}

describe('RabbitMQConsumer ante un broker caído', () => {
  let connections: FakeConnection[];

  // El consumer guarda su estado en campos estáticos: cada test usa un módulo nuevo.
  async function loadConsumer() {
    const { RabbitMQConsumer } = await import('./consumer.js');
    return RabbitMQConsumer;
  }

  // La app debe cargarse después del reset para compartir ese mismo consumer.
  async function loadApp() {
    const { createSupportApp } = await import('../app.js');
    const { InMemoryTicketRepository } = await import('../models/ticket.model.js');
    const { TicketService } = await import('../services/ticket.service.js');
    return createSupportApp({ ticketService: new TicketService(new InMemoryTicketRepository()) });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    connections = [];
    amqpMock.connect.mockReset();
    amqpMock.connect.mockImplementation(async () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('no rechaza ni repite el ack cuando el canal está cerrado', async () => {
    const consumer = await loadConsumer();
    await consumer.connect('amqp://test');
    const channel = connections[0].channel;
    channel.ack.mockImplementation(() => {
      throw channelClosedError();
    });

    await expect(
      channel.handler!(message('ticket.actualizado', JSON.stringify({ id: 't-1', estado: 'EN_PROCESO' })))
    ).resolves.toBeUndefined();

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('confirma una sola vez un mensaje que no se puede procesar', async () => {
    const consumer = await loadConsumer();
    await consumer.connect('amqp://test');
    const channel = connections[0].channel;

    await expect(channel.handler!(message('viaje.completado', 'esto-no-es-json'))).resolves.toBeUndefined();

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('sobrevive al cierre de canal y conexión y reconecta una sola vez', async () => {
    const consumer = await loadConsumer();
    await consumer.connect('amqp://test');
    const first = connections[0];

    expect(() => dropBroker(first)).not.toThrow();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(amqpMock.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(amqpMock.connect).toHaveBeenCalledTimes(2);
    expect(connections[1].channel.consume).toHaveBeenCalledTimes(1);

    // Un evento tardío de la conexión descartada no dispara otra reconexión.
    first.emit('close');
    await vi.advanceTimersByTimeAsync(10000);
    expect(amqpMock.connect).toHaveBeenCalledTimes(2);
  });

  it('reintenta sin lanzar cuando el broker no está disponible al arrancar', async () => {
    amqpMock.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const consumer = await loadConsumer();

    await expect(consumer.connect('amqp://test')).resolves.toBeUndefined();
    expect(amqpMock.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(amqpMock.connect).toHaveBeenCalledTimes(2);
    expect(connections).toHaveLength(1);
  });

  it('la API de tickets sigue funcionando con el broker caído', async () => {
    const consumer = await loadConsumer();
    const app = await loadApp();
    await consumer.connect('amqp://test');
    dropBroker(connections[0]);
    vi.useRealTimers();

    const created = await request(app).post('/tickets').send({ viajeId: 'viaje-sin-broker', motivo: 'Demora' });
    expect(created.status).toBe(201);

    const found = await request(app).get(`/tickets/${created.body.id}`);
    expect(found.status).toBe(200);

    const updated = await request(app).patch(`/tickets/${created.body.id}/estado`).send({ estado: 'EN_PROCESO' });
    expect(updated.status).toBe(200);
    expect(updated.body.estado).toBe('EN_PROCESO');

    const published = await request(app)
      .post('/events/publish')
      .send({ routingKey: 'viaje.completado', payload: { viajeId: 'viaje-sin-broker' } });
    expect(published.status).toBe(200);
    expect(published.body.enviadosExitosamente).toBe(0);
  });

  it('crear un ticket no falla si publicar lanza con el canal aún asignado', async () => {
    const consumer = await loadConsumer();
    const app = await loadApp();
    await consumer.connect('amqp://test');
    connections[0].channel.publish.mockImplementation(() => {
      throw channelClosedError();
    });
    vi.useRealTimers();

    const created = await request(app).post('/tickets').send({ viajeId: 'viaje-canal-roto', motivo: 'Demora' });
    expect(created.status).toBe(201);
  });
});
