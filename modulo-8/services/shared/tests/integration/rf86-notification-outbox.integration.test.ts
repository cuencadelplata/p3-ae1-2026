import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  NotificationOutboxRelay,
  M3DriverDocumentConsumer,
  M3_EXCHANGE,
  M3_QUEUE,
  M3_ROUTING_KEY,
  assertTopology,
  buildQueueTopology,
  PostgresTechnicalInbox,
  publishWithConfirm,
} from '../../src/index';

const PG_URL =
  process.env.NOTIFICATIONS_DATABASE_URL ||
  'postgres://m8_admin:m8_admin_local@localhost:5432/m8';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

async function waitForMessage(channel: amqp.Channel, queues: string[], timeoutMs = 4000): Promise<{ queue: string; msg: amqp.ConsumeMessage }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const q of queues) {
      const msg = await channel.get(q, { noAck: false });
      if (msg !== false) {
        return { queue: q, msg };
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout esperando mensaje en colas: ${queues.join(', ')}`);
}

describe('RF8.6 Real Infrastructure - Notification Outbox Relay & M3 Consumer', () => {
  let pgPool: Pool;
  let amqpConn: amqp.ChannelModel;
  let amqpChannel: amqp.Channel;

  beforeAll(async () => {
    pgPool = new Pool({ connectionString: PG_URL });

    // Asegurar esquema notifications y tabla outbox_deliveries
    await pgPool.query(`CREATE SCHEMA IF NOT EXISTS notifications`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notifications.notifications (
        notification_id uuid PRIMARY KEY,
        source_message_id text NOT NULL,
        trip_id text NULL,
        ride_request_id text NULL,
        recipient_id text NOT NULL,
        event_type text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        CONSTRAINT notifications_source_message_recipient_key UNIQUE (source_message_id, recipient_id)
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notifications.outbox_deliveries (
        message_id uuid PRIMARY KEY,
        notification_id uuid NOT NULL REFERENCES notifications.notifications (notification_id),
        event_type text NOT NULL,
        routing_key text NOT NULL,
        correlation_id text NOT NULL,
        version integer NOT NULL,
        producer text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        published_at timestamptz NULL,
        CONSTRAINT notifications_outbox_deliveries_notification_event_key UNIQUE (notification_id, event_type)
      )
    `);

    // Asegurar esquema messaging e inbox_events para RF8.6
    await pgPool.query(`CREATE SCHEMA IF NOT EXISTS messaging`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS messaging.inbox_events (
        consumer_id VARCHAR(100) NOT NULL,
        message_id VARCHAR(100) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (consumer_id, message_id)
      )
    `);

    amqpConn = await amqp.connect(RABBIT_URL);
    amqpChannel = await amqpConn.createConfirmChannel();
  });

  afterAll(async () => {
    await amqpChannel?.close().catch(() => {});
    await amqpConn?.close().catch(() => {});
    await pgPool?.end().catch(() => {});
  });

  it('1. publica una intención pendiente de notifications.outbox_deliveries a RabbitMQ con Publisher Confirms y marca published_at', async () => {
    const testId = randomUUID();
    const notificationId = randomUUID();
    const messageId = randomUUID();
    const tripId = `trip-${Date.now()}`;

    // 1. Insertar notificación lógica de RF8.1
    await pgPool.query(
      `INSERT INTO notifications.notifications (
         notification_id, source_message_id, trip_id, recipient_id,
         event_type, title, message, correlation_id, occurred_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        notificationId,
        `source-${testId}`,
        tripId,
        '42',
        'TripStarted',
        'Viaje iniciado',
        'Tu viaje ha comenzado.',
        tripId,
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    // 2. Insertar intención Outbox pendiente
    const payload = {
      notificationId,
      tripId,
      recipientId: 42,
      eventType: 'TRIP_STARTED',
      channel: 'PUSH',
      message: 'Tu viaje ha comenzado.',
      createdAt: new Date().toISOString(),
    };

    await pgPool.query(
      `INSERT INTO notifications.outbox_deliveries (
         message_id, notification_id, event_type, routing_key, correlation_id,
         version, producer, payload, created_at, published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
      [
        messageId,
        notificationId,
        'NotificationRequested',
        'notification.requested',
        tripId,
        1,
        'm8-notifications',
        JSON.stringify(payload),
        new Date().toISOString(),
      ]
    );

    // 3. Afirmar topología de entrega de RF8.7
    const deliveryQueue = `test.m8.delivery.notification-requested.${Date.now()}`;
    const topology = buildQueueTopology({
      queue: deliveryQueue,
      routingKey: 'notification.requested',
    });
    await assertTopology(amqpChannel, topology);

    try {
      // 4. Instanciar y ejecutar relay RF8.6
      const relay = new NotificationOutboxRelay({
        pool: pgPool,
        connection: amqpConn,
      });

      const publishedCount = await relay.publishPendingWithChannel(amqpChannel, 10);
      expect(publishedCount).toBeGreaterThanOrEqual(1);

      // 5. Verificar que el registro quedó marcado como publicado en PostgreSQL real
      const row = await pgPool.query<{ published_at: Date | null }>(
        `SELECT published_at FROM notifications.outbox_deliveries WHERE message_id = $1`,
        [messageId]
      );
      expect(row.rows[0].published_at).not.toBeNull();

      // 6. Verificar que el mensaje llegó a la cola de RF8.7 con el sobre NotificationRequested congelado
      const { msg } = await waitForMessage(amqpChannel, [deliveryQueue]);
      expect(msg).not.toBeNull();
      const parsed = JSON.parse(msg.content.toString('utf8'));

      expect(parsed.messageId).toBe(messageId);
      expect(parsed.eventType).toBe('NotificationRequested');
      expect(parsed.version).toBe(1);
      expect(parsed.producer).toBe('m8-notifications');
      expect(parsed.correlationId).toBe(tripId);
      expect(parsed.data.notificationId).toBe(notificationId);
      expect(parsed.data.recipientId).toBe(42);
      expect(parsed.data.eventType).toBe('TRIP_STARTED');
      expect(parsed.data.channel).toBe('PUSH');

      amqpChannel.ack(msg);
    } finally {
      await amqpChannel.deleteQueue(deliveryQueue).catch(() => {});
      await amqpChannel.deleteQueue(`${deliveryQueue}.retry`).catch(() => {});
      await amqpChannel.deleteQueue(`${deliveryQueue}.dlq`).catch(() => {});
    }
  }, 15000);

  it('2. demuestra exclusión mutua concurrente con dos instancias de relay usando FOR UPDATE SKIP LOCKED', async () => {
    const batchId = Date.now();
    const count = 4;
    const insertedIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const notifId = randomUUID();
      const msgId = randomUUID();
      insertedIds.push(msgId);

      await pgPool.query(
        `INSERT INTO notifications.notifications (
           notification_id, source_message_id, trip_id, recipient_id,
           event_type, title, message, correlation_id, occurred_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          notifId,
          `source-${batchId}-${i}`,
          `trip-${batchId}-${i}`,
          '100',
          'DriverAssigned',
          'Conductor asignado',
          'Conductor en camino.',
          `trip-${batchId}-${i}`,
          new Date().toISOString(),
          new Date().toISOString(),
        ]
      );

      const payload = {
        notificationId: notifId,
        tripId: `trip-${batchId}-${i}`,
        recipientId: 100,
        eventType: 'DRIVER_ASSIGNED',
        channel: 'PUSH',
        message: 'Conductor en camino.',
        createdAt: new Date().toISOString(),
      };

      await pgPool.query(
        `INSERT INTO notifications.outbox_deliveries (
           message_id, notification_id, event_type, routing_key, correlation_id,
           version, producer, payload, created_at, published_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          msgId,
          notifId,
          'NotificationRequested',
          'notification.requested',
          `trip-${batchId}-${i}`,
          1,
          'm8-notifications',
          JSON.stringify(payload),
          new Date(Date.now() - (count - i) * 1000).toISOString(),
        ]
      );
    }

    const channelB = await amqpConn.createConfirmChannel();
    try {
      const relay1 = new NotificationOutboxRelay({ pool: pgPool, connection: amqpConn });
      const relay2 = new NotificationOutboxRelay({ pool: pgPool, connection: amqpConn });

      // Ejecutar simultáneamente ambos relays compitiendo por los registros pendientes
      const [res1, res2] = await Promise.all([
        relay1.publishPendingWithChannel(amqpChannel, 2),
        relay2.publishPendingWithChannel(channelB, 2),
      ]);

      expect(res1 + res2).toBeGreaterThanOrEqual(2);

      // Verificar que todos los registros procesados tienen published_at no nulo y no hay colisiones
      const check = await pgPool.query<{ message_id: string; published_at: Date | null }>(
        `SELECT message_id, published_at FROM notifications.outbox_deliveries WHERE message_id = ANY($1)`,
        [insertedIds]
      );

      const published = check.rows.filter((r) => r.published_at !== null);
      expect(published.length).toBeGreaterThanOrEqual(res1 + res2);
    } finally {
      await channelB.close().catch(() => {});
    }
  }, 15000);

  it('3. resiliencia: si RabbitMQ falla durante publish, la transacción se aborta y published_at permanece NULL', async () => {
    const notifId = randomUUID();
    const msgId = randomUUID();
    const tripId = `trip-fail-${Date.now()}`;

    await pgPool.query(
      `INSERT INTO notifications.notifications (
         notification_id, source_message_id, trip_id, recipient_id,
         event_type, title, message, correlation_id, occurred_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        notifId,
        `source-fail-${Date.now()}`,
        tripId,
        '200',
        'TripCompleted',
        'Viaje finalizado',
        'Gracias por viajar.',
        tripId,
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    const payload = {
      notificationId: notifId,
      tripId,
      recipientId: 200,
      eventType: 'TRIP_COMPLETED',
      channel: 'PUSH',
      message: 'Gracias por viajar.',
      createdAt: new Date().toISOString(),
    };

    await pgPool.query(
      `INSERT INTO notifications.outbox_deliveries (
         message_id, notification_id, event_type, routing_key, correlation_id,
         version, producer, payload, created_at, published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
      [
        msgId,
        notifId,
        'NotificationRequested',
        'notification.requested',
        tripId,
        1,
        'm8-notifications',
        JSON.stringify(payload),
        new Date().toISOString(),
      ]
    );

    // Crear un canal inválido o cerrado para forzar un fallo al publicar
    const brokenChannel = {
      publish: vi.fn((_ex, _rk, _content, _opt, cb) => {
        if (typeof cb === 'function') cb(new Error('Broker connection refused (simulada)'));
        return false;
      }),
      assertExchange: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as amqp.Channel;

    const relay = new NotificationOutboxRelay({ pool: pgPool });
    const count = await relay.publishPendingWithChannel(brokenChannel, 10);
    expect(count).toBe(0);

    // Comprobar que en PostgreSQL real el registro NO quedó publicado y conserva su estado
    const row = await pgPool.query<{ published_at: Date | null }>(
      `SELECT published_at FROM notifications.outbox_deliveries WHERE message_id = $1`,
      [msgId]
    );
    expect(row.rows[0].published_at).toBeNull();
  });

  it('4. integración M3 -> RF8.6 Consumer -> RF8.1 -> Outbox Relay -> RabbitMQ con deduplicación por messageId', async () => {
    const testDocId = randomUUID();
    const testMsgId = randomUUID();

    const inboxStore = new PostgresTechnicalInbox(pgPool);

    // Mock handler que emula a RF8.1 persistiendo notificación y outbox
    const rf81Handler = vi.fn(async (event: any) => {
      const notifId = randomUUID();
      const outboxMsgId = randomUUID();

      await pgPool.query(
        `INSERT INTO notifications.notifications (
           notification_id, source_message_id, trip_id, recipient_id,
           event_type, title, message, correlation_id, occurred_at, created_at
         ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (source_message_id, recipient_id) DO NOTHING`,
        [
          notifId,
          event.messageId,
          String(event.driverId),
          'DriverDocumentRegistered',
          'Documento registrado',
          'Tu documento fue registrado correctamente.',
          event.correlationId,
          event.occurredAt,
          new Date().toISOString(),
        ]
      );

      const payload = {
        notificationId: notifId,
        recipientId: event.driverId,
        eventType: 'DRIVER_DOCUMENT_REGISTERED',
        channel: 'PUSH',
        message: 'Tu documento fue registrado correctamente.',
        createdAt: new Date().toISOString(),
      };

      await pgPool.query(
        `INSERT INTO notifications.outbox_deliveries (
           message_id, notification_id, event_type, routing_key, correlation_id,
           version, producer, payload, created_at, published_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
         ON CONFLICT (notification_id, event_type) DO NOTHING`,
        [
          outboxMsgId,
          notifId,
          'NotificationRequested',
          'notification.requested',
          event.correlationId,
          1,
          'm8-notifications',
          JSON.stringify(payload),
          new Date().toISOString(),
        ]
      );

      return { status: 'SUCCESS_CREATED' as const, valid: true };
    });

    const m3Consumer = new M3DriverDocumentConsumer({
      connection: amqpConn,
      inboxStore,
      rf81Handler,
    });

    await m3Consumer.start();

    try {
      // 1. M3 publica documento.registrado en m3.eventos
      const m3Envelope = {
        messageId: testMsgId,
        eventType: 'DriverDocumentRegistered',
        version: 1,
        occurredAt: new Date().toISOString(),
        correlationId: testDocId,
        producer: 'm3-conductores',
        data: {
          documentId: testDocId,
          driverId: 77,
          tipoDocumento: 'LICENCIA',
        },
      };

      await publishWithConfirm(
        amqpChannel,
        M3_EXCHANGE,
        M3_ROUTING_KEY,
        Buffer.from(JSON.stringify(m3Envelope)),
        { contentType: 'application/json', persistent: true, messageId: testMsgId }
      );

      // Esperar a que el consumidor RF8.6 lo procese y complete el Inbox
      await new Promise((r) => setTimeout(r, 600));
      expect(rf81Handler).toHaveBeenCalledTimes(1);

      // 2. Re-publicar el MISMO messageId (simulación de redelivery o duplicado externo)
      await publishWithConfirm(
        amqpChannel,
        M3_EXCHANGE,
        M3_ROUTING_KEY,
        Buffer.from(JSON.stringify(m3Envelope)),
        { contentType: 'application/json', persistent: true, messageId: testMsgId }
      );

      await new Promise((r) => setTimeout(r, 600));

      // El Inbox debe haber evitado la segunda ejecución de RF8.1
      expect(rf81Handler).toHaveBeenCalledTimes(1);

      // 3. Ejecutar relay de RF8.6 para publicar la intención generada
      const relay = new NotificationOutboxRelay({ pool: pgPool, connection: amqpConn });
      const published = await relay.publishPendingWithChannel(amqpChannel, 10);
      expect(published).toBeGreaterThanOrEqual(1);

      // Verificar en la DB que la intención de entrega fue marcada como publicada
      const outboxCheck = await pgPool.query(
        `SELECT o.published_at FROM notifications.outbox_deliveries o
         JOIN notifications.notifications n ON n.notification_id = o.notification_id
         WHERE n.source_message_id = $1`,
        [testMsgId]
      );
      expect(outboxCheck.rows).toHaveLength(1);
      expect(outboxCheck.rows[0].published_at).not.toBeNull();
    } finally {
      await m3Consumer.stop();
    }
  }, 20000);
});
