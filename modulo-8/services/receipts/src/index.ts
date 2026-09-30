import { createApp } from './app';
import { closeRedis, connectRedis } from './cache/redis';
import { env } from './config/env';
import { runMigrations } from './db/migrations';
import { closePool } from './db/pool';
import { startConsumer } from './messaging/consumer';
import { startOutboxRelay } from './messaging/outbox-relay';
import { PAYMENT_CONFIRMED_ROUTING_KEY, processPaymentConfirmed } from './messaging/payment-confirmed';
import { queueTopology } from './messaging/topology';
import { createLogger, errorFields } from './observability/logger';

const log = createLogger('server');

async function bootstrap(): Promise<void> {
  await runMigrations();

  // Sin Redis el servicio arranca igual: solo quedan sin servicio los enlaces
  // temporales, y el cliente reintenta la conexion por su cuenta.
  void connectRedis().catch(() => undefined);

  // RF-8.6: la emision del comprobante se dispara de forma asincronica cuando M7
  // confirma el pago. Si RabbitMQ no esta disponible, la API REST sigue
  // funcionando y el consumidor reintenta la conexion.
  const consumerLog = createLogger('payment-confirmed');
  const consumer = startConsumer({
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
  const relay = startOutboxRelay({
    name: 'outbox',
    url: env.rabbitmqUrl,
    exchange: env.eventsExchange,
    intervalMs: env.outboxPollIntervalMs,
    batchSize: env.outboxBatchSize,
  });

  const app = createApp({
    checks: { rabbitmq: async () => consumer.isConnected() && relay.isConnected() },
  });
  const server = app.listen(env.port, () => {
    log('info', 'servicio iniciado', {
      url: env.publicBaseUrl,
      api: `${env.publicBaseUrl}${env.apiPrefix}/receipts`,
      environment: env.nodeEnv,
      version: env.serviceVersion,
    });
  });

  const shutdown = (signal: string): void => {
    log('info', 'cerrando el servidor', { signal });
    server.close((error) => {
      Promise.all([consumer.close(), relay.close()])
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

bootstrap().catch((error: unknown) => {
  log('error', 'no se pudo iniciar el servicio', errorFields(error));
  process.exit(1);
});
