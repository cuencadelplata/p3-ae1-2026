import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import * as amqp from 'amqplib';
import type { Channel } from 'amqplib';

import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { pool } from '../../src/db/pool';
import { RETRY_COUNT_HEADER, startConsumer, type RunningConsumer } from '../../src/messaging/consumer';
import { PAYMENT_CONFIRMED_ROUTING_KEY, processPaymentConfirmed } from '../../src/messaging/payment-confirmed';
import { queueTopology, type QueueTopology } from '../../src/messaging/topology';
import { paymentConfirmedEvent, toBuffer } from '../helpers/payment-confirmed.fixture';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

const RETRY_DELAY_MS = 100;
const MAX_RETRIES = 3;

/** Nombres unicos para no interferir con el servicio si esta levantado. */
function testTopology(suffix: string): QueueTopology {
  const run = `${Date.now()}-${suffix}`;
  return queueTopology({
    exchange: `test.mobility.events.${run}`,
    deadLetterExchange: `test.mobility.events.dlx.${run}`,
    routingKey: PAYMENT_CONFIRMED_ROUTING_KEY,
    queue: `test.m8.receipts.payment-confirmed.${run}`,
  });
}

async function waitFor<T>(check: () => Promise<T | null | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`La condicion no se cumplio en ${timeoutMs} ms`);
}

async function countReceipts(tripId: string): Promise<number> {
  const result = await pool.query('SELECT 1 FROM receipts.receipts WHERE trip_id = $1', [tripId]);
  return result.rowCount ?? 0;
}

async function isProcessed(messageId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM receipts.processed_messages WHERE message_id = $1', [messageId]);
  return (result.rowCount ?? 0) > 0;
}

describe('Consumidor de payment.confirmed (Integration RabbitMQ + PostgreSQL)', () => {
  let connection: Connection;
  let channel: Channel;
  const consumers: RunningConsumer[] = [];
  const topologies: QueueTopology[] = [];

  function consume(topology: QueueTopology, handle = processPaymentConfirmed): Promise<void> {
    topologies.push(topology);
    const consumer = startConsumer({
      name: 'test-payment-confirmed',
      url: env.rabbitmqUrl,
      topology,
      prefetch: 5,
      maxRetries: MAX_RETRIES,
      retryDelayMs: RETRY_DELAY_MS,
      reconnectDelayMs: 200,
      handle,
    });
    consumers.push(consumer);
    return consumer.whenReady();
  }

  function publish(topology: QueueTopology, content: Buffer, messageId?: string): void {
    channel.publish(topology.exchange, topology.routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      ...(messageId ? { messageId } : {}),
    });
  }

  before(async () => {
    await runMigrations();
    connection = await amqp.connect(env.rabbitmqUrl);
    channel = await connection.createChannel();
  });

  after(async () => {
    await Promise.all(consumers.map((consumer) => consumer.close()));
    for (const topology of topologies) {
      for (const queue of [topology.queue, topology.retryQueue, topology.deadLetterQueue]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(topology.exchange);
      await channel.deleteExchange(topology.deadLetterExchange);
    }
    await connection.close();
  });

  it('debe emitir el comprobante al recibir un pago confirmado', async () => {
    const topology = testTopology('ok');
    await consume(topology);

    const tripId = `trip-mq-ok-${Date.now()}`;
    const event = paymentConfirmedEvent(tripId);
    publish(topology, toBuffer(event), event.messageId);

    await waitFor(() => isProcessed(event.messageId));
    assert.equal(await countReceipts(tripId), 1);
  });

  it('debe descartar la reentrega de un mismo mensaje sin emitir otro comprobante', async () => {
    const topology = testTopology('duplicado');
    let handled = 0;
    const outcomes: string[] = [];
    await consume(topology, async (content) => {
      const outcome = await processPaymentConfirmed(content);
      handled += 1;
      outcomes.push(outcome.status);
      return outcome;
    });

    const tripId = `trip-mq-dup-${Date.now()}`;
    const event = paymentConfirmedEvent(tripId);
    publish(topology, toBuffer(event), event.messageId);
    await waitFor(async () => handled === 1);
    publish(topology, toBuffer(event), event.messageId);
    await waitFor(async () => handled === 2);

    assert.deepEqual(outcomes, ['processed', 'duplicate']);
    assert.equal(await countReceipts(tripId), 1);
  });

  it('debe emitir un unico comprobante aunque M7 publique dos mensajes distintos para el mismo viaje', async () => {
    const topology = testTopology('mismo-viaje');
    await consume(topology);

    const tripId = `trip-mq-viaje-${Date.now()}`;
    const first = paymentConfirmedEvent(tripId);
    const second = paymentConfirmedEvent(tripId);
    publish(topology, toBuffer(first), first.messageId);
    publish(topology, toBuffer(second), second.messageId);

    await waitFor(async () => (await isProcessed(first.messageId)) && (await isProcessed(second.messageId)));
    assert.equal(await countReceipts(tripId), 1);
  });

  it('debe enviar un mensaje invalido a la DLQ sin reintentarlo', async () => {
    const topology = testTopology('invalido');
    let attempts = 0;
    await consume(topology, async (content) => {
      attempts += 1;
      return processPaymentConfirmed(content);
    });

    publish(topology, Buffer.from('{"esto": "no respeta el sobre"}'), 'mensaje-invalido');

    const dead = await waitFor(async () => (await channel.get(topology.deadLetterQueue, { noAck: true })) || null);
    assert.equal(dead.properties.messageId, 'mensaje-invalido');
    assert.equal(attempts, 1);
  });

  it('debe reintentar ante fallos transitorios y enviar el mensaje a la DLQ al agotar los reintentos', async () => {
    const topology = testTopology('transitorio');
    let attempts = 0;
    await consume(topology, async () => {
      attempts += 1;
      throw new Error('base de datos no disponible (simulado)');
    });

    const event = paymentConfirmedEvent(`trip-mq-retry-${Date.now()}`);
    publish(topology, toBuffer(event), event.messageId);

    const dead = await waitFor(async () => (await channel.get(topology.deadLetterQueue, { noAck: true })) || null);
    assert.equal(attempts, MAX_RETRIES + 1);
    assert.equal(dead.properties.headers?.[RETRY_COUNT_HEADER], MAX_RETRIES);
    assert.equal(dead.properties.messageId, event.messageId);
  });

  it('debe procesar el mensaje si el fallo transitorio se resuelve en un reintento', async () => {
    const topology = testTopology('recuperado');
    let attempts = 0;
    await consume(topology, async (content) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('corte momentaneo (simulado)');
      }
      return processPaymentConfirmed(content);
    });

    const tripId = `trip-mq-recupera-${Date.now()}`;
    const event = paymentConfirmedEvent(tripId);
    publish(topology, toBuffer(event), event.messageId);

    await waitFor(() => isProcessed(event.messageId));
    assert.equal(attempts, 2);
    assert.equal(await countReceipts(tripId), 1);
  });
});
