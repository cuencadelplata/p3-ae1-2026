import { createApp } from './app';
import { closeRedis, connectRedis } from './cache/redis';
import { env } from './config/env';
import { runMigrations } from './db/migrations';
import { closePool } from './db/pool';
import { startConsumer } from './messaging/consumer';
import { startOutboxRelay } from './messaging/outbox-relay';
import { PAYMENT_CONFIRMED_ROUTING_KEY, processPaymentConfirmed } from './messaging/payment-confirmed';
import { queueTopology } from './messaging/topology';

async function bootstrap(): Promise<void> {
  await runMigrations();

  // Sin Redis el servicio arranca igual: solo quedan sin servicio los enlaces
  // temporales, y el cliente reintenta la conexion por su cuenta.
  void connectRedis().catch(() => undefined);

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.info(`[${env.serviceName}] escuchando en ${env.publicBaseUrl} (entorno: ${env.nodeEnv})`);
    console.info(`[${env.serviceName}] API disponible en ${env.publicBaseUrl}${env.apiPrefix}/receipts`);
  });

  // RF-8.6: la emision del comprobante se dispara de forma asincronica cuando M7
  // confirma el pago. Si RabbitMQ no esta disponible, la API REST sigue
  // funcionando y el consumidor reintenta la conexion.
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
        console.info(
          `[payment-confirmed] mensaje repetido descartado messageId=${outcome.messageId} tripId=${outcome.tripId}`,
        );
        return;
      }
      console.info(
        `[payment-confirmed] comprobante ${outcome.created ? 'emitido' : 'ya existente'} messageId=${outcome.messageId} tripId=${outcome.tripId} receiptId=${outcome.receiptId}`,
      );
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

  const shutdown = (signal: string): void => {
    console.info(`[${env.serviceName}] senal ${signal} recibida, cerrando el servidor`);
    server.close((error) => {
      Promise.all([consumer.close(), relay.close()])
        .then(() => Promise.all([closePool(), closeRedis()]))
        .catch((closeError: unknown) => {
          console.error(`[${env.serviceName}] error al liberar las conexiones`, closeError);
        })
        .finally(() => {
          if (error) {
            console.error(`[${env.serviceName}] error al cerrar el servidor`, error);
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
  console.error('No se pudo iniciar el servicio', error);
  process.exit(1);
});
