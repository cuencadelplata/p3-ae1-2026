import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import * as amqp from 'amqplib';
import type { Channel } from 'amqplib';

import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { pool } from '../../src/db/pool';
import { PAYMENT_CONFIRMED_ROUTING_KEY, toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { buildReceiptIssuedEvent } from '../../src/messaging/receipt-issued';
import { queueTopology, type QueueTopology } from '../../src/messaging/topology';
import type { Receipt, ReceiptRequest } from '../../src/models/receipt';
import * as repository from '../../src/repositories/receipt.repository';
import { paymentConfirmedEvent, toBuffer } from '../helpers/payment-confirmed.fixture';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ReplicaMessage =
  | { type: 'ready'; port: number }
  | { type: 'handled'; replica: string; status: 'duplicate' | 'processed'; created: boolean };

interface Replica {
  name: string;
  port: number;
  process: ChildProcess;
  handled: Array<Extract<ReplicaMessage, { type: 'handled' }>>;
}

const CONCURRENT = 8;

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`La condicion no se cumplio en ${timeoutMs} ms`);
}

/**
 * Hace que todas las tareas terminen la consulta antes de que cualquiera
 * inserte. Reproduce de forma determinista la ventana que en el servicio abre
 * la generacion del PDF entre findByTripId y create.
 */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) {
      release();
    }
    return opened;
  };
}

function requestFor(tripId: string): ReceiptRequest {
  const request = toReceiptRequest(paymentConfirmedEvent(tripId));
  assert.ok(request.ok);
  return request.value;
}

function receiptFor(tripId: string): Receipt {
  const receiptId = randomUUID();
  return {
    ...requestFor(tripId),
    receiptId,
    receiptNumber: `CMP-CONC-${receiptId.slice(0, 8).toUpperCase()}`,
    issuedAt: new Date().toISOString(),
    deliveries: [],
  };
}

async function count(table: string, column: string, value: string): Promise<number> {
  const result = await pool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [value]);
  return result.rowCount ?? 0;
}

describe('Concurrencia e idempotencia de la emision (RNF-08 / RNF-09)', () => {
  before(async () => {
    await runMigrations();
  });

  describe('Carrera de consultar y despues insertar', () => {
    const run = Date.now();
    const unprotected = `receipts.carrera_sin_unique_${run}`;

    after(async () => {
      await pool.query(`DROP TABLE IF EXISTS ${unprotected}`);
    });

    it('sin la restriccion UNIQUE, pedidos simultaneos emiten un comprobante cada uno', async () => {
      // Misma logica que la emision, pero sobre una tabla sin UNIQUE(trip_id).
      await pool.query(`CREATE TABLE ${unprotected} (receipt_id uuid PRIMARY KEY, trip_id text NOT NULL)`);
      const tripId = `trip-carrera-${run}`;
      const allChecked = barrier(CONCURRENT);

      await Promise.all(
        Array.from({ length: CONCURRENT }, async () => {
          const exists = (await count(unprotected, 'trip_id', tripId)) > 0;
          await allChecked();
          if (!exists) {
            await pool.query(`INSERT INTO ${unprotected} (receipt_id, trip_id) VALUES ($1, $2)`, [randomUUID(), tripId]);
          }
        }),
      );

      assert.equal(await count(unprotected, 'trip_id', tripId), CONCURRENT);
    });

    it('con la restriccion UNIQUE, la misma carrera deja un unico comprobante y un unico evento', async () => {
      const tripId = `trip-carrera-unique-${run}`;
      const allChecked = barrier(CONCURRENT);

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT }, async () => {
          const existing = await repository.findByTripId(tripId);
          await allChecked();
          if (!existing) {
            const receipt = receiptFor(tripId);
            await repository.create(receipt, Buffer.from('%PDF-1.3 prueba'), buildReceiptIssuedEvent(receipt));
          }
        }),
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(results.length - rejected.length, 1);
      for (const result of rejected) {
        assert.ok(result.reason instanceof repository.ReceiptAlreadyExistsError);
      }
      assert.equal(await count('receipts.receipts', 'trip_id', tripId), 1);
      assert.equal(await count('receipts.outbox_events', 'correlation_id', tripId), 1);
    });
  });

  describe('Dos replicas del servicio en paralelo', () => {
    const run = Date.now();
    const topology: QueueTopology = queueTopology({
      exchange: `test.mobility.events.${run}-replicas`,
      deadLetterExchange: `test.mobility.events.dlx.${run}-replicas`,
      routingKey: PAYMENT_CONFIRMED_ROUTING_KEY,
      queue: `test.m8.receipts.payment-confirmed.${run}-replicas`,
    });
    const replicas: Replica[] = [];
    let connection: Connection;
    let channel: Channel;

    function startReplica(name: string): Promise<Replica> {
      const child = fork(path.join(__dirname, '../helpers/replica.ts'), {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, REPLICA_NAME: name, REPLICA_TOPOLOGY: JSON.stringify(topology) },
        silent: true,
      });
      child.stdout?.resume();
      child.stderr?.pipe(process.stderr);

      return new Promise((resolve, reject) => {
        const replica: Replica = { name, port: 0, process: child, handled: [] };
        child.on('message', (message: ReplicaMessage) => {
          if (message.type === 'ready') {
            replica.port = message.port;
            resolve(replica);
          } else {
            replica.handled.push(message);
          }
        });
        child.once('exit', (code) => reject(new Error(`La replica ${name} termino antes de estar lista (codigo ${code})`)));
      });
    }

    const handledCount = (): number => replicas.reduce((total, replica) => total + replica.handled.length, 0);

    before(async () => {
      replicas.push(...(await Promise.all([startReplica('replica-a'), startReplica('replica-b')])));
      connection = await amqp.connect(env.rabbitmqUrl);
      channel = await connection.createChannel();
    });

    after(async () => {
      await Promise.all(
        replicas.map(
          (replica) =>
            new Promise<void>((resolve) => {
              replica.process.once('exit', () => resolve());
              replica.process.send('stop');
            }),
        ),
      );
      for (const queue of [topology.queue, topology.retryQueue, topology.deadLetterQueue]) {
        await channel.deleteQueue(queue);
      }
      await channel.deleteExchange(topology.exchange);
      await channel.deleteExchange(topology.deadLetterExchange);
      await connection.close();
    });

    it('mensajes duplicados repartidos entre las dos replicas producen un solo comprobante', async () => {
      const tripId = `trip-replicas-mq-${run}`;
      const redelivered = paymentConfirmedEvent(tripId);
      const others = [paymentConfirmedEvent(tripId), paymentConfirmedEvent(tripId)];
      // El mismo mensaje tres veces (reentregas) y otros dos mensajes del mismo viaje, dos veces cada uno.
      const messages = [redelivered, redelivered, redelivered, ...others, ...others];

      for (const event of messages) {
        channel.publish(topology.exchange, topology.routingKey, toBuffer(event), {
          persistent: true,
          contentType: 'application/json',
          messageId: event.messageId,
        });
      }

      await waitFor(() => handledCount() === messages.length);

      for (const replica of replicas) {
        assert.ok(replica.handled.length > 0, `la replica ${replica.name} debe haber procesado mensajes`);
      }
      const created = replicas.flatMap((replica) => replica.handled).filter((outcome) => outcome.created);
      assert.equal(created.length, 1);
      assert.equal(await count('receipts.receipts', 'trip_id', tripId), 1);
      assert.equal(await count('receipts.outbox_events', 'correlation_id', tripId), 1);
    });

    it('pedidos HTTP simultaneos repartidos entre las dos replicas producen un solo comprobante', async () => {
      const tripId = `trip-replicas-http-${run}`;
      const body = JSON.stringify(requestFor(tripId));

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT }, (_, index) =>
          fetch(`http://127.0.0.1:${replicas[index % replicas.length]?.port}/api/v1/receipts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          }),
        ),
      );
      const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
        data: { receiptId: string };
      }>;

      assert.equal(responses.filter((response) => response.status === 201).length, 1);
      assert.equal(responses.filter((response) => response.status === 200).length, CONCURRENT - 1);
      assert.equal(new Set(bodies.map((item) => item.data.receiptId)).size, 1);
      assert.equal(await count('receipts.receipts', 'trip_id', tripId), 1);
      assert.equal(await count('receipts.outbox_events', 'correlation_id', tripId), 1);
    });
  });
});
