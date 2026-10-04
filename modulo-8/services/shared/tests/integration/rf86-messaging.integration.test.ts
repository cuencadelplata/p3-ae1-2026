import { describe, expect, it, vi } from 'vitest';
import type { Channel } from 'amqplib';
import {
  adaptExternalEvent,
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  InMemoryTechnicalInbox,
  OutboxPublisher,
  PostgresTechnicalInbox,
  publishWithConfirm,
} from '../../src';

describe('RF8.6 Integration - PostgreSQL Inbox (messaging.inbox_events)', () => {
  it('debe ejecutar comandos SQL con esquema messaging e inbox_events', async () => {
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const mockPgClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params: params || [] });
        if (sql.includes('INSERT INTO messaging.inbox_events') && sql.includes('RETURNING 1')) {
          return { rows: [{ id: 1 }] };
        }
        return { rows: [] };
      },
    };

    const pgInbox = new PostgresTechnicalInbox(mockPgClient);
    const consumerId = 'm8.notifications';
    const messageId = 'b1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    const eventType = 'NotificationRequested';

    // 1. Reclamo inicial
    const claimed = await pgInbox.claim(consumerId, messageId, eventType);
    expect(claimed).toBe(true);
    expect(executedQueries[0].sql).toContain('INSERT INTO messaging.inbox_events');
    expect(executedQueries[0].params).toEqual([consumerId, messageId, eventType]);

    // 2. Marcar como completado
    await pgInbox.markAsCompleted(consumerId, messageId);
    expect(executedQueries[1].sql).toContain('UPDATE messaging.inbox_events');
    expect(executedQueries[1].params).toEqual([consumerId, messageId]);

    // 3. Verificacion de procesamiento
    await pgInbox.hasBeenProcessed(consumerId, messageId);
    expect(executedQueries[2].sql).toContain('SELECT 1 FROM messaging.inbox_events');
  });

  it('debe liberar el claim en PostgreSQL ante falla en el handler', async () => {
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const mockPgClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params: params || [] });
        return { rows: [] };
      },
    };

    const pgInbox = new PostgresTechnicalInbox(mockPgClient);
    await pgInbox.releaseClaim('m8.notifications', 'msg-123');

    expect(executedQueries[0].sql).toContain('DELETE FROM messaging.inbox_events');
    expect(executedQueries[0].sql).toContain("status = 'PENDING'");
    expect(executedQueries[0].params).toEqual(['m8.notifications', 'msg-123']);
  });
});

describe('RF8.6 Integration - RabbitMQ Topologia, Confirms y EventConsumer', () => {
  function createMockConfirmChannel() {
    const queues = new Map<string, any>();
    const exchanges = new Set<string>();

    const channel: Partial<Channel> & Record<string, any> = {
      assertExchange: vi.fn(async (ex: string) => {
        exchanges.add(ex);
        return {} as any;
      }),
      assertQueue: vi.fn(async (q: string) => {
        queues.set(q, { queue: q, messageCount: 0, consumerCount: 0 });
        return { queue: q, messageCount: 0, consumerCount: 0 } as any;
      }),
      bindQueue: vi.fn(async () => {
        return {} as any;
      }),

      publish: vi.fn((_ex: string, _rk: string, _content: Buffer, _options: any, cb: (err?: any) => void) => {
        if (typeof cb === 'function') cb();
        return true;
      }),
      consume: vi.fn(async (_q: string, _cb: any) => {
        return { consumerTag: 'test-tag' };
      }),
      cancel: vi.fn(async () => {
        return {} as any;
      }),

      ack: vi.fn(),
      waitForConfirms: vi.fn(async () => true),
    };

    return channel as Channel;
  }

  it('debe configurar la topologia de colas y exchanges (mobility.events, DLX, retry)', async () => {
    const channel = createMockConfirmChannel();
    const topology = buildQueueTopology({
      queue: 'm8.notifications.trip-events',
      routingKey: 'trip.#',
    });

    await assertTopology(channel, topology);

    expect(channel.assertExchange).toHaveBeenCalledWith('mobility.events', 'topic', { durable: true });
    expect(channel.assertExchange).toHaveBeenCalledWith('mobility.events.dlx', 'topic', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('m8.notifications.trip-events', expect.objectContaining({ durable: true }));
    expect(channel.assertQueue).toHaveBeenCalledWith('m8.notifications.trip-events.dlq', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('m8.notifications.trip-events.retry', expect.objectContaining({ durable: true }));
  });

  it('debe publicar eventos con Publisher Confirms usando publishWithConfirm', async () => {
    const channel = createMockConfirmChannel();
    const content = Buffer.from(JSON.stringify({ test: 'data' }));

    await publishWithConfirm(channel, 'mobility.events', 'trip.completed', content, { persistent: true });

    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events',
      'trip.completed',
      content,
      { persistent: true },
      expect.any(Function)
    );
  });

  it('debe demostrar redelivery idempotente sin re-ejecutar el handler de negocio', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.notifications-consumer',
      topology: { queue: 'm8.notifications.queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
    });

    let handlerCalls = 0;
    consumer.registerHandler('TripCompleted', async () => {
      handlerCalls++;
    });

    const rawPayload = JSON.stringify({
      eventType: 'trip_completed',
      trip_id: '999',
      producer: 'm6',
    });

    // 1. Primera entrega
    const msg1 = {
      content: Buffer.from(rawPayload),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg1);
    expect(handlerCalls).toBe(1);

    // 2. Redelivery del mismo mensaje crudo (el adaptador genera el mismo messageId estable)
    const msg2 = {
      content: Buffer.from(rawPayload),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: { 'x-redelivered': true } },
    } as any;

    await consumer.processMessage(channel, msg2);
    expect(handlerCalls).toBe(1); // No vuelve a ejecutarse!
    expect(channel.ack).toHaveBeenCalledTimes(2);
  });
});
