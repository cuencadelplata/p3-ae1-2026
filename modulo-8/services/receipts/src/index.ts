import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from './app';
import { closeRedis, connectRedis } from './cache/redis';
import { env } from './config/env';
import { runMigrations } from './db/migrations';
import { closePool, isDatabaseReady } from './db/pool';
import { startConsumer, type RunningConsumer } from './messaging/consumer';
import { startOutboxRelay, type RunningRelay } from './messaging/outbox-relay';
import { PAYMENT_CONFIRMED_ROUTING_KEY, processPaymentConfirmed } from './messaging/payment-confirmed';
import { queueTopology } from './messaging/topology';
import { createLogger, errorFields, errorMessage } from './observability/logger';

const log = createLogger('server');

let closing = false;
let schemaReady = false;
let consumer: RunningConsumer | undefined;
let relay: RunningRelay | undefined;

/**
 * Prepara el esquema reintentando hasta que PostgreSQL responda. El servicio no
 * termina si la base no esta disponible al arrancar: sigue atendiendo
 * /health/live, informa la base como no disponible en /health/ready y se
 * recupera solo cuando vuelve.
 */
async function prepareDatabase(): Promise<boolean> {
  for (let attempt = 1; !closing; attempt += 1) {
    try {
      await runMigrations();
      if (attempt > 1) {
        log('info', 'PostgreSQL disponible, esquema preparado', { attempt });
      }
      return true;
    } catch (error) {
      log('warn', 'PostgreSQL no disponible al arrancar, se reintenta', {
        attempt,
        delayMs: env.databaseStartupRetryMs,
        reason: errorMessage(error),
      });
      await sleep(env.databaseStartupRetryMs);
    }
  }
  return false;
}

/** Consumidor de payment.confirmed y relay de la bandeja de salida: necesitan el esquema creado. */
function startMessaging(): void {
  // RF-8.6: la emision del comprobante se dispara de forma asincronica cuando M7
  // confirma el pago. Si RabbitMQ no esta disponible, la API REST sigue
  // funcionando y el consumidor reintenta la conexion.
  const consumerLog = createLogger('payment-confirmed');
  consumer = startConsumer({
    name: 'payment-confirmed',
    url: env.rabbitmqUrl,
    topology: queueTopology({
      exchange: env.eventsExchange,
      deadLetterExchange: env.deadLetterExchange,
      routingKey: PAYMENT_CONFIRMED_ROUTING_KEY,
      queue: env.paymentConfirmedQueue,
    }),
    prefetch: env.consumerPrefetch,
    maxRetries: env.consumerMaxRetries,
    retryDelayMs: env.consumerRetryDelayMs,
    handle: async (content) => {
      const outcome = await processPaymentConfirmed(content);
      if (outcome.status === 'duplicate') {
        consumerLog('info', 'mensaje repetido descartado', { messageId: outcome.messageId, tripId: outcome.tripId });
        return;
      }
      consumerLog('info', outcome.created ? 'comprobante emitido' : 'comprobante ya existente', {
        messageId: outcome.messageId,
        tripId: outcome.tripId,
        receiptId: outcome.receiptId,
      });
    },
  });

  // receipt.issued se publica desde la bandeja de salida: el evento ya quedo
  // guardado junto con el comprobante y aca solo se envia a RabbitMQ.
  relay = startOutboxRelay({
    name: 'outbox',
    url: env.rabbitmqUrl,
    exchange: env.eventsExchange,
    intervalMs: env.outboxPollIntervalMs,
    batchSize: env.outboxBatchSize,
  });
}

function bootstrap(): void {
  // Sin Redis el servicio arranca igual: solo quedan sin servicio los enlaces
  // temporales, y el cliente reintenta la conexion por su cuenta.
  void connectRedis().catch(() => undefined);

  const app = createApp({
    checks: {
      postgres: async () => schemaReady && (await isDatabaseReady()),
      rabbitmq: async () => Boolean(consumer?.isConnected() && relay?.isConnected()),
    },
  });

  // El servidor HTTP arranca antes que la base: asi /health responde aunque
  // PostgreSQL todavia no este disponible.
  const server = app.listen(env.port, () => {
    log('info', 'servicio iniciado', {
      url: env.publicBaseUrl,
      api: `${env.publicBaseUrl}${env.apiPrefix}/receipts`,
      environment: env.nodeEnv,
      version: env.serviceVersion,
    });
  });

  void prepareDatabase().then((ready) => {
    if (ready) {
      schemaReady = true;
      startMessaging();
    }
  });

  const shutdown = (signal: string): void => {
    log('info', 'cerrando el servidor', { signal });
    closing = true;
    server.close((error) => {
      Promise.all([consumer?.close(), relay?.close()])
        .then(() => Promise.all([closePool(), closeRedis()]))
        .catch((closeError: unknown) => {
          log('error', 'error al liberar las conexiones', errorFields(closeError));
        })
        .finally(() => {
          if (error) {
            log('error', 'error al cerrar el servidor', errorFields(error));
            process.exit(1);
          }
          process.exit(0);
        });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  bootstrap();
} catch (error) {
  log('error', 'no se pudo iniciar el servicio', errorFields(error));
  process.exit(1);
}
