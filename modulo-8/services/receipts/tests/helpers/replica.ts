/**
 * Replica del servicio de comprobantes para las pruebas de concurrencia.
 *
 * Corre en un proceso aparte, con su propio pool de PostgreSQL, su propia
 * conexion a RabbitMQ y su propio servidor HTTP, igual que un segundo
 * contenedor. Por eso nada que viva en memoria (como el candado por tripId de
 * AE1) se comparte entre replicas.
 *
 * La prueba la lanza con fork y se comunica por IPC:
 * - REPLICA_NAME y REPLICA_TOPOLOGY (JSON) llegan por variables de entorno.
 * - Envia { type: 'ready', port } cuando escucha HTTP y la cola.
 * - Envia { type: 'handled', replica, status, created } por cada mensaje.
 * - Termina al recibir 'stop'.
 */
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { closePool } from '../../src/db/pool';
import { startConsumer } from '../../src/messaging/consumer';
import { processPaymentConfirmed } from '../../src/messaging/payment-confirmed';
import type { QueueTopology } from '../../src/messaging/topology';

const name = process.env['REPLICA_NAME'] ?? 'replica';
const topology = JSON.parse(process.env['REPLICA_TOPOLOGY'] ?? '{}') as QueueTopology;

const send = (message: object): void => {
  process.send?.(message);
};

const consumer = startConsumer({
  name,
  url: env.rabbitmqUrl,
  topology,
  prefetch: 5,
  maxRetries: 3,
  retryDelayMs: 100,
  reconnectDelayMs: 200,
  handle: async (content) => {
    const outcome = await processPaymentConfirmed(content);
    send({
      type: 'handled',
      replica: name,
      status: outcome.status,
      created: outcome.status === 'processed' && outcome.created,
    });
  },
});

const server = createApp().listen(0, () => {
  const { port } = server.address() as AddressInfo;
  void consumer.whenReady().then(() => send({ type: 'ready', port }));
});

process.on('message', (message) => {
  if (message === 'stop') {
    server.close();
    void consumer
      .close()
      .then(() => closePool())
      .finally(() => process.exit(0));
  }
});
