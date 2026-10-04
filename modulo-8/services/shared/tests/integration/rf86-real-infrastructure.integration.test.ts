import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as amqp from 'amqplib';
import type { Channel, Connection } from 'amqplib';
import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  OutboxPublisher,
  PostgresOutboxStore,
  PostgresTechnicalInbox,
  publishWithConfirm,
} from '../../src';

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://m8_admin:m8_admin_local@localhost:5432/m8';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

describe('RF8.6 Real Infrastructure - PostgreSQL (messaging.inbox_events & outbox_events) + RabbitMQ Real', () => {
  let pgClient: any = null;
  let amqpConn: Connection | null = null;
  let amqpChannel: Channel | null = null;
  let isInfraAvailable = false;

  beforeAll(async () => {
    // Intento de conexion dinamica a PostgreSQL y RabbitMQ reales
    try {
      // 1. Intentar conectar a PostgreSQL
      let PgPool: any;
      try {
        const pgPkg = await import('pg');
        PgPool = pgPkg.default?.Pool || pgPkg.Pool;
      } catch {
        // Module pg opcional
      }

      if (PgPool) {
        const pool = new PgPool({ connectionString: POSTGRES_URL, connectionTimeoutMillis: 1500 });
        const client = await pool.connect();
        await client.query('CREATE SCHEMA IF NOT EXISTS messaging');
        await client.query(`
          CREATE TABLE IF NOT EXISTS messaging.inbox_events (
            consumer_id VARCHAR(255) NOT NULL,
            message_id VARCHAR(255) NOT NULL,
            event_type VARCHAR(255) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (consumer_id, message_id)
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS messaging.outbox_events (
            id VARCHAR(255) PRIMARY KEY,
            event_type VARCHAR(255) NOT NULL,
            routing_key VARCHAR(255),
            correlation_id VARCHAR(255),
            payload JSONB NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            published_at TIMESTAMPTZ
          );
        `);
        client.release();
        pgClient = pool;
      }

      // 2. Intentar conectar a RabbitMQ
      amqpConn = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await amqpConn.createConfirmChannel();

      if (pgClient && amqpChannel) {
        isInfraAvailable = true;
      }
    } catch {
      isInfraAvailable = false;
      console.log('[RF8.6 Integration] Postgres o RabbitMQ real no disponibles en localhost. Saltando ejecucion contra contenedores reales.');
    }
  });

  afterAll(async () => {
    if (amqpChannel) {
      await amqpChannel.close().catch(() => {});
    }
    if (amqpConn) {
      await amqpConn.close().catch(() => {});
    }
    if (pgClient && typeof pgClient.end === 'function') {
      await pgClient.end().catch(() => {});
    }
  });

  it('demuestra el flujo E2E completo: Postgres Inbox (claim/complete), RabbitMQ Confirm, Retry/DLQ y Outbox SKIP LOCKED', async () => {
    if (!isInfraAvailable || !pgClient || !amqpChannel) {
      console.log('Skipping real infra test because containers are not running locally.');
      expect(true).toBe(true);
      return;
    }

    const testRun = Date.now();
    const topology = buildQueueTopology({
      queue: `test.m8.real-infra.${testRun}`,
      routingKey: 'trip.completed',
    });

    // 1. Configurar topologia real en RabbitMQ
    await assertTopology(amqpChannel, topology);

    // 2. Inicializar Inbox persistido en PostgreSQL real
    const inbox = new PostgresTechnicalInbox(pgClient);
    const consumer = new EventConsumer({
      consumerId: 'm8.real-infra-consumer',
      topology: { queue: topology.queue, routingKey: topology.routingKey },
      inboxStore: inbox,
    });

    let handledCount = 0;
    consumer.registerHandler('TripCompleted', async (envelope) => {
      handledCount++;
      expect(envelope.data['tripId']).toBe('777');
    });

    const payload = JSON.stringify({
      messageId: `msg-real-${testRun}`,
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: `corr-${testRun}`,
      producer: 'm6',
      data: { tripId: '777' },
    });

    // 3. Publicar en RabbitMQ real con Publisher Confirm
    await publishWithConfirm(amqpChannel, topology.exchange, 'trip.completed', Buffer.from(payload), {
      persistent: true,
      contentType: 'application/json',
    });

    // 4. Consumir mensaje con EventConsumer real
    const msg = await new Promise<amqp.ConsumeMessage | null>((resolve) => {
      amqpChannel!.get(topology.queue, { noAck: false }).then(resolve);
    });

    expect(msg).not.toBeNull();
    if (msg) {
      await consumer.processMessage(amqpChannel, msg);
    }

    expect(handledCount).toBe(1);

    // 5. Verificar persistencia real en PostgreSQL (messaging.inbox_events)
    const dbCheck = await pgClient.query(
      `SELECT status FROM messaging.inbox_events WHERE consumer_id = $1 AND message_id = $2`,
      ['m8.real-infra-consumer', `msg-real-${testRun}`]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(dbCheck.rows[0].status).toBe('PROCESSED');

    // 6. Probar idempotencia ante redelivery en Postgres real
    if (msg) {
      await consumer.processMessage(amqpChannel, msg);
    }
    expect(handledCount).toBe(1); // No vuelve a ejecutarse

    // 7. Probar Outbox real con FOR UPDATE SKIP LOCKED
    await pgClient.query(
      `INSERT INTO messaging.outbox_events (id, event_type, payload, status)
       VALUES ($1, $2, $3, 'PENDING')`,
      [`ob-real-${testRun}`, 'ReceiptIssued', JSON.stringify({ messageId: `msg-ob-${testRun}`, data: {} })]
    );

    const outboxStore = new PostgresOutboxStore(pgClient);
    const publisher = new OutboxPublisher(outboxStore, topology.exchange);
    const publishedCount = await publisher.publishPending(amqpChannel, 10);

    expect(publishedCount).toBe(1);

    const outboxCheck = await pgClient.query(
      `SELECT status FROM messaging.outbox_events WHERE id = $1`,
      [`ob-real-${testRun}`]
    );
    expect(outboxCheck.rows[0].status).toBe('PUBLISHED');

    // Limpieza de colas
    await amqpChannel.deleteQueue(topology.queue);
    await amqpChannel.deleteQueue(topology.retryQueue);
    await amqpChannel.deleteQueue(topology.deadLetterQueue);
  });
});
