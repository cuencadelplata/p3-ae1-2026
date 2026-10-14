import { describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelModel } from 'amqplib';
import type { Pool, PoolClient } from 'pg';
import {
  NotificationOutboxRelay,
  PostgresNotificationOutboxStore,
  mapNotificationOutboxRowToEnvelope,
  mapNotificationOutboxRowToEntry,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_ROUTING_KEY,
} from '../../src/messaging/notification-outbox';

function createMockChannel() {
  const channel = {
    publish: vi.fn((_exchange, _routingKey, _content, _options, cb) => {
      if (typeof cb === 'function') cb(null);
      return true;
    }),
    assertExchange: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return channel as unknown as Channel;
}

function createMockConnection(channel: Channel) {
  const connection = {
    createConfirmChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return connection as unknown as ChannelModel;
}

function createSampleOutboxRow(overrides = {}) {
  return {
    message_id: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
    notification_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    event_type: NOTIFICATION_REQUESTED_EVENT_TYPE,
    routing_key: NOTIFICATION_REQUESTED_ROUTING_KEY,
    correlation_id: 'trip-2026-000123',
    version: 1,
    producer: 'm8-notifications',
    payload: {
      notificationId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      tripId: 'trip-2026-000123',
      recipientId: 91,
      eventType: 'TRIP_STARTED',
      channel: 'PUSH',
      message: 'Tu viaje ha comenzado.',
      createdAt: '2026-10-05T18:42:12.000Z',
    },
    created_at: new Date('2026-10-05T18:42:12.500Z'),
    published_at: null,
    ...overrides,
  };
}

describe('RF8.6 - PostgresNotificationOutboxStore', () => {
  it('mapea correctamente filas de outbox_deliveries a Envelope y OutboxEntry', () => {
    const row = createSampleOutboxRow();
    const envelope = mapNotificationOutboxRowToEnvelope(row);
    expect(envelope).toEqual({
      messageId: row.message_id,
      eventType: NOTIFICATION_REQUESTED_EVENT_TYPE,
      version: 1,
      occurredAt: row.created_at.toISOString(),
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: row.payload,
    });

    const entry = mapNotificationOutboxRowToEntry(row);
    expect(entry.id).toBe(row.message_id);
    expect(entry.eventType).toBe(NOTIFICATION_REQUESTED_EVENT_TYPE);
    expect(entry.payload).toEqual(envelope);
  });

  it('fetchPending lee registros donde published_at es NULL', async () => {
    const row = createSampleOutboxRow();
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const pool = { query } as unknown as Pool;

    const store = new PostgresNotificationOutboxStore(pool);
    const pending = await store.fetchPending(5);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE published_at IS NULL'), [5]);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(row.message_id);
  });

  it('markAsPublished actualiza published_at con NOW()', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const pool = { query } as unknown as Pool;

    const store = new PostgresNotificationOutboxStore(pool);
    await store.markAsPublished('test-msg-id');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifications.outbox_deliveries'),
      ['test-msg-id']
    );
  });
});

describe('RF8.6 - NotificationOutboxRelay', () => {
  it('1. publica una intención pendiente con eventType NotificationRequested, routingKey notification.requested y messageId original', async () => {
    const row = createSampleOutboxRow();
    const mockClient = {
      query: vi.fn((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});
        if (sql.includes('SELECT message_id')) return Promise.resolve({ rows: [row] });
        if (sql.includes('UPDATE notifications.outbox_deliveries')) return Promise.resolve({ rowCount: 1 });
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;

    const channel = createMockChannel();
    const connection = createMockConnection(channel);

    const relay = new NotificationOutboxRelay({
      pool,
      connection,
      exchange: 'mobility.events',
      routingKey: 'notification.requested',
    });

    const publishedCount = await relay.publishPendingWithChannel(channel, 10);
    expect(publishedCount).toBe(1);

    // Verificaciones obligatorias
    expect(channel.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content, options] = (channel.publish as any).mock.calls[0];
    expect(exchange).toBe('mobility.events');
    expect(routingKey).toBe('notification.requested');
    expect(options.messageId).toBe(row.message_id);
    expect(options.persistent).toBe(true);
    expect(options.contentType).toBe('application/json');

    const publishedEnvelope = JSON.parse(content.toString('utf8'));
    expect(publishedEnvelope.messageId).toBe(row.message_id);
    expect(publishedEnvelope.eventType).toBe('NotificationRequested');
    expect(publishedEnvelope.version).toBe(1);
    expect(publishedEnvelope.producer).toBe('m8-notifications');
    expect(publishedEnvelope.data).toEqual(row.payload);

    // 2. Comprobación de que tras Publisher Confirm se marca published_at en la transacción
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifications.outbox_deliveries'),
      expect.arrayContaining([row.message_id])
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('3. si falla RabbitMQ o el confirm falla: no marca publicado, aborta transacción y permite reintento', async () => {
    const row = createSampleOutboxRow();
    const mockClient = {
      query: vi.fn((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});
        if (sql.includes('SELECT message_id')) return Promise.resolve({ rows: [row] });
        if (sql.includes('UPDATE notifications.outbox_deliveries')) return Promise.resolve({ rowCount: 1 });
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;

    const channel = {
      publish: vi.fn((_exchange, _routingKey, _content, _options, cb) => {
        if (typeof cb === 'function') cb(new Error('RabbitMQ Broker NACK / Channel Closed'));
        return false;
      }),
      assertExchange: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Channel;

    const relay = new NotificationOutboxRelay({
      pool,
      exchange: 'mobility.events',
      routingKey: 'notification.requested',
    });

    const publishedCount = await relay.publishPendingWithChannel(channel, 10);
    expect(publishedCount).toBe(0);

    // Verificación: NO debe ejecutarse COMMIT ni marcarse published_at
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('4. concurrencia: consulta incluye FOR UPDATE SKIP LOCKED para prevenir publicación simultánea entre instancias', async () => {
    let capturedQuery = '';
    const mockClient = {
      query: vi.fn((sql: string) => {
        if (sql.includes('SELECT message_id')) {
          capturedQuery = sql;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({});
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;

    const channel = createMockChannel();
    const relay = new NotificationOutboxRelay({ pool });

    await relay.publishPendingWithChannel(channel, 10);

    expect(capturedQuery).toContain('FOR UPDATE SKIP LOCKED');
    expect(capturedQuery).toContain('published_at IS NULL');
    expect(capturedQuery).toContain('ORDER BY created_at ASC, message_id ASC');
  });

  it('5. ciclo de vida: inicia y se detiene limpiamente sin dejar timers ni recursos abiertos', async () => {
    const channel = createMockChannel();
    const connection = createMockConnection(channel);
    const pool = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      }),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;

    const relay = new NotificationOutboxRelay({
      pool,
      ownsPool: true,
      connection,
      pollIntervalMs: 50,
    });

    await relay.start();
    expect(relay.isReady()).toBe(true);

    await relay.stop();
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
