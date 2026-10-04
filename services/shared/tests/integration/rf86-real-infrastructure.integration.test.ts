import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as amqp from 'amqplib';
import type { Channel, Connection } from 'amqplib';
import { Pool } from 'pg';
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
  let pgPool: Pool;
  let amqpConn: Connection;
  let amqpChannel: Channel;

  beforeAll(async () => {
    // 1. Conectar a PostgreSQL real
    try {
      pgPool = new Pool({ connectionString: POSTGRES_URL, connectionTimeoutMillis: 2000 });
      await pgPool.query('SELECT 1');
    } catch (err) {
      throw new Error(
        `[RF8.6 Real Infra Error] No se pudo conectar a PostgreSQL real en ${POSTGRES_URL}.\n` +
        `Asegurate de haber iniciado los contenedores con 'docker compose up -d postgres rabbitmq'. Error: ${(err as Error).message}`
      );
    }

    // 2. Conectar a RabbitMQ real
    try {
      amqpConn = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await amqpConn.createConfirmChannel();
    } catch (err) {
      if (pgPool) await pgPool.end().catch(() => {});
      throw new Error(
        `[RF8.6 Real Infra Error] No se pudo conectar a RabbitMQ real en ${RABBITMQ_URL}.\n` +
        `Asegurate de haber iniciado los contenedores con 'docker compose up -d postgres rabbitmq'. Error: ${(err as Error).message}`
      );
    }

    // 3. Verificar que el esquema messaging y las tablas existen (creados por 02-messaging.sh init script)
    try {
      await pgPool.query('SELECT 1 FROM messaging.inbox_events LIMIT 1');
      await pgPool.query('SELECT 1 FROM messaging.outbox_events LIMIT 1');
    } catch (err) {
      throw new Error(
        `[RF8.6 Real Infra Error] Las tablas messaging.inbox_events u outbox_events no existen en la base de datos real.\n` +
        `Verifica que el script de inicializacion 02-messaging.sh se haya ejecutado. Error: ${(err as Error).message}`
      );
    }
  });

  afterAll(async () => {
    if (amqpChannel) {
      await amqpChannel.close().catch(() => {});
    }
    if (amqpConn) {
      await amqpConn.close().catch(() => {});
    }
    if (pgPool) {
      await pgPool.end().catch(() => {});
    }
  });

  it('demuestra Inbox real, deduplicacion e idempotencia ante redelivery en PostgreSQL', async () => {
    const testRun = Date.now();
    const topology = buildQueueTopology({
      queue: `test.m8.real-inbox.${testRun}`,
      routingKey: 'trip.completed',
    });

    await assertTopology(amqpChannel, topology);

    const inbox = new PostgresTechnicalInbox(pgPool);
    const consumer = new EventConsumer({
      consumerId: `m8.real-consumer-${testRun}`,
      topology: { queue: topology.queue, routingKey: topology.routingKey },
      inboxStore: inbox,
    });

    let handledCount = 0;
    consumer.registerHandler('TripCompleted', async (envelope) => {
      handledCount++;
      expect(envelope.data['tripId']).toBe('777');
    });

    const msgId = randomUUID();
    const correlationId = randomUUID();
    const payload = JSON.stringify({
      messageId: msgId,
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: correlationId,
      producer: 'm6',
      data: { tripId: '777' },
    });

    // Publicar evento en RabbitMQ real con Publisher Confirm
    await publishWithConfirm(amqpChannel, topology.exchange, 'trip.completed', Buffer.from(payload), {
      persistent: true,
      contentType: 'application/json',
    });

    // Consumir mensaje inicial
    const msg = await new Promise<amqp.ConsumeMessage | null>((resolve) => {
      amqpChannel.get(topology.queue, { noAck: false }).then(resolve);
    });

    expect(msg).not.toBeNull();
    if (msg) {
      await consumer.processMessage(amqpChannel, msg);
    }

    expect(handledCount).toBe(1);

    // Verificar en PostgreSQL real (messaging.inbox_events)
    const dbCheck = await pgPool.query(
      `SELECT status FROM messaging.inbox_events WHERE consumer_id = $1 AND message_id = $2`,
      [`m8.real-consumer-${testRun}`, msgId]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(dbCheck.rows[0].status).toBe('PROCESSED');

    // Simular redelivery del mismo mensaje -> Inbox previene re-ejecucion
    if (msg) {
      await consumer.processMessage(amqpChannel, msg);
    }
    expect(handledCount).toBe(1); // Mantiene 1 ejecucion

    // Limpiar colas de test
    await amqpChannel.deleteQueue(topology.queue);
    await amqpChannel.deleteQueue(topology.retryQueue);
    await amqpChannel.deleteQueue(topology.deadLetterQueue);
  });

  it('demuestra retry (3 reintentos) y derivacion a DLQ real en RabbitMQ ante fallos del handler', async () => {
    const testRun = Date.now();
    const topology = buildQueueTopology({
      queue: `test.m8.real-retry-dlq.${testRun}`,
      routingKey: 'trip.cancelled',
    });

    await assertTopology(amqpChannel, topology);

    const inbox = new PostgresTechnicalInbox(pgPool);
    const consumer = new EventConsumer({
      consumerId: `m8.real-failing-consumer-${testRun}`,
      topology: { queue: topology.queue, routingKey: topology.routingKey },
      inboxStore: inbox,
      maxRetries: 3,
      retryDelayMs: 100,
    });

    let attempts = 0;
    consumer.registerHandler('TripCancelled', async () => {
      attempts++;
      throw new Error(`Fallo simulado en intento ${attempts}`);
    });

    const msgId = randomUUID();
    const correlationId = randomUUID();
    const payload = JSON.stringify({
      messageId: msgId,
      eventType: 'TripCancelled',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: correlationId,
      producer: 'm6',
      data: { tripId: '888' },
    });

    await publishWithConfirm(amqpChannel, topology.exchange, 'trip.cancelled', Buffer.from(payload), {
      persistent: true,
      contentType: 'application/json',
    });

    // Simular ciclo de intentos y re-ejecuciones
    for (let i = 0; i <= 3; i++) {
      const msg = await new Promise<amqp.ConsumeMessage | null>((resolve) => {
        amqpChannel.get(i === 0 ? topology.queue : topology.retryQueue, { noAck: false }).then(resolve);
      });
      if (msg) {
        await consumer.processMessage(amqpChannel, msg);
      }
    }

    expect(attempts).toBe(4); // 1 intento inicial + 3 reintentos

    // Verificar que el mensaje termino en la DLQ real
    const dlqMsg = await new Promise<amqp.ConsumeMessage | null>((resolve) => {
      amqpChannel.get(topology.deadLetterQueue, { noAck: true }).then(resolve);
    });

    expect(dlqMsg).not.toBeNull();
    if (dlqMsg) {
      expect(dlqMsg.properties.headers['x-dlq-reason']).toContain('Fallo simulado');
    }

    await amqpChannel.deleteQueue(topology.queue);
    await amqpChannel.deleteQueue(topology.retryQueue);
    await amqpChannel.deleteQueue(topology.deadLetterQueue);
  });

  it('demuestra Outbox concurrente con 2 publicadores usando FOR UPDATE SKIP LOCKED en PostgreSQL real', async () => {
    const testRun = Date.now();
    const topology = buildQueueTopology({
      queue: `test.m8.real-outbox-concurrent.${testRun}`,
      routingKey: 'receipt.issued',
    });

    await assertTopology(amqpChannel, topology);

    // Insertar 6 eventos outbox PENDING en PostgreSQL real
    const outboxIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const id = randomUUID();
      outboxIds.push(id);
      await pgPool.query(
        `INSERT INTO messaging.outbox_events (id, event_type, payload, status)
         VALUES ($1, $2, $3, 'PENDING')`,
        [id, 'ReceiptIssued', JSON.stringify({ messageId: id, data: { receiptNo: i } })]
      );
    }

    const storeA = new PostgresOutboxStore(pgPool);
    const storeB = new PostgresOutboxStore(pgPool);
    const publisherA = new OutboxPublisher(storeA, topology.exchange);
    const publisherB = new OutboxPublisher(storeB, topology.exchange);

    // Crear un segundo canal para el segundo publisher
    const channelB = await amqpConn.createConfirmChannel();

    // Ejecutar ambos publicadores concurrentemente
    const [countA, countB] = await Promise.all([
      publisherA.publishPending(amqpChannel, 6),
      publisherB.publishPending(channelB, 6),
    ]);

    expect(countA + countB).toBe(6); // Total de 6 eventos procesados entre los 2 publicadores
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBeGreaterThan(0);

    // Verificar en PostgreSQL que los 6 eventos quedaron en estado PUBLISHED
    const dbCheck = await pgPool.query(
      `SELECT status FROM messaging.outbox_events WHERE id = ANY($1::varchar[])`,
      [outboxIds]
    );

    expect(dbCheck.rows.length).toBe(6);
    for (const row of dbCheck.rows) {
      expect(row.status).toBe('PUBLISHED');
    }

    await channelB.close().catch(() => {});
    await amqpChannel.deleteQueue(topology.queue);
    await amqpChannel.deleteQueue(topology.retryQueue);
    await amqpChannel.deleteQueue(topology.deadLetterQueue);
  });
});
