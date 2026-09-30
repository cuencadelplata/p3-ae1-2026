import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import * as amqp from 'amqplib';
import type { Channel } from 'amqplib';

import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { pool } from '../../src/db/pool';
import type { EventEnvelope } from '../../src/messaging/envelope';
import { startOutboxRelay, type RunningRelay } from '../../src/messaging/outbox-relay';
import { processPaymentConfirmed, toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { RECEIPT_ISSUED_ROUTING_KEY, type ReceiptIssuedData } from '../../src/messaging/receipt-issued';
import { issueReceipt } from '../../src/services/receipt.service';
import { paymentConfirmedEvent, toBuffer } from '../helpers/payment-confirmed.fixture';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

const POLL_INTERVAL_MS = 50;

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
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

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function outboxRows(tripId: string): Promise<Array<{ message_id: string; published_at: Date | null }>> {
  const result = await pool.query<{ message_id: string; published_at: Date | null }>(
    'SELECT message_id, published_at FROM receipts.outbox_events WHERE correlation_id = $1',
    [tripId],
  );
  return result.rows;
}

function requestFor(tripId: string) {
  const request = toReceiptRequest(paymentConfirmedEvent(tripId));
  assert.ok(request.ok);
  return request.value;
}

/**
 * La cola de la prueba se liga al exchange real: recibe el evento aunque lo
 * publique el servicio levantado en vez del relay de la prueba.
 */
describe('Publicacion de receipt.issued (Integration PostgreSQL + RabbitMQ)', () => {
  let connection: Connection;
  let channel: Channel;
  const received: Array<EventEnvelope<ReceiptIssuedData>> = [];
  const relays: RunningRelay[] = [];

  function startRelay(url = env.rabbitmqUrl): RunningRelay {
    const relay = startOutboxRelay({
      name: 'test-outbox',
      url,
      exchange: env.eventsExchange,
      intervalMs: POLL_INTERVAL_MS,
      batchSize: 20,
      reconnectDelayMs: 200,
    });
    relays.push(relay);
    return relay;
  }

  const receivedFor = (tripId: string) => received.filter((event) => event.correlationId === tripId);

  before(async () => {
    await runMigrations();
    connection = await amqp.connect(env.rabbitmqUrl);
    channel = await connection.createChannel();
    await channel.assertExchange(env.eventsExchange, 'topic', { durable: true });
    const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
    await channel.bindQueue(queue, env.eventsExchange, RECEIPT_ISSUED_ROUTING_KEY);
    await channel.consume(
      queue,
      (message) => {
        if (message) {
          received.push(JSON.parse(message.content.toString('utf8')) as EventEnvelope<ReceiptIssuedData>);
        }
      },
      { noAck: true },
    );
  });

  afterEach(async () => {
    await Promise.all(relays.splice(0).map((relay) => relay.close()));
  });

  after(async () => {
    await connection.close();
  });

  it('debe publicar receipt.issued despues de persistir el comprobante', async () => {
    const relay = startRelay();
    await relay.whenReady();

    const { receipt } = await issueReceipt(requestFor(`trip-outbox-ok-${Date.now()}`));

    const [event] = await waitFor(async () => receivedFor(receipt.tripId).length > 0 && receivedFor(receipt.tripId));
    assert.equal(event?.eventType, 'ReceiptIssued');
    assert.equal(event?.data.receiptId, receipt.receiptId);
    assert.equal(event?.data.receiptNumber, receipt.receiptNumber);

    const [row] = await outboxRows(receipt.tripId);
    assert.equal(row?.message_id, event?.messageId);
    assert.ok(row?.published_at instanceof Date);
  });

  it('no debe publicar un segundo receipt.issued ante un payment.confirmed repetido', async () => {
    const relay = startRelay();
    await relay.whenReady();

    const tripId = `trip-outbox-dup-${Date.now()}`;
    const event = paymentConfirmedEvent(tripId);
    await processPaymentConfirmed(toBuffer(event));
    await processPaymentConfirmed(toBuffer(event));
    await processPaymentConfirmed(toBuffer(paymentConfirmedEvent(tripId)));
    await issueReceipt(requestFor(tripId));

    await waitFor(async () => receivedFor(tripId).length > 0);
    await pause(POLL_INTERVAL_MS * 6);

    assert.equal(receivedFor(tripId).length, 1);
    assert.equal((await outboxRows(tripId)).length, 1);
  });

  it('debe conservar el evento si RabbitMQ no esta disponible y publicarlo al recuperarse', async () => {
    startRelay('amqp://guest:guest@127.0.0.1:1');

    const { receipt } = await issueReceipt(requestFor(`trip-outbox-caida-${Date.now()}`));

    // Se verifica enseguida: si el servicio esta levantado, su relay es otra
    // replica que lee la misma tabla y, pasado su intervalo, publicaria el evento.
    // En CI las pruebas corren solo contra PostgreSQL, RabbitMQ y Redis.
    const [pending] = await outboxRows(receipt.tripId);
    assert.equal(pending?.published_at, null);
    assert.equal(receivedFor(receipt.tripId).length, 0);

    await startRelay().whenReady();
    await waitFor(async () => receivedFor(receipt.tripId).length === 1);
    const [published] = await outboxRows(receipt.tripId);
    assert.ok(published?.published_at instanceof Date);
  });

  it('debe publicar cada evento una sola vez aunque corran dos instancias', async () => {
    await Promise.all([startRelay().whenReady(), startRelay().whenReady()]);

    const run = Date.now();
    const tripIds = Array.from({ length: 10 }, (_, index) => `trip-outbox-replicas-${run}-${index}`);
    await Promise.all(tripIds.map((tripId) => issueReceipt(requestFor(tripId))));

    await waitFor(async () => tripIds.every((tripId) => receivedFor(tripId).length > 0));
    await pause(POLL_INTERVAL_MS * 6);

    for (const tripId of tripIds) {
      assert.equal(receivedFor(tripId).length, 1, `el viaje ${tripId} debe tener un unico evento`);
    }
  });
});
