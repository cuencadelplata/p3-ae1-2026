import { setTimeout as sleep } from 'node:timers/promises';

import cors from 'cors';
import express, { Router } from 'express';

import { closeRedis, connectRedis, isRedisReady } from './cache/redis';
import { env } from './config/env';
import { getDeliveryReference } from './controllers/receipt.controller';
import { runMigrations } from './db/migrations';
import { closePool, isDatabaseReady } from './db/pool';
import { fiscalClient } from './integrations/fiscal-authorizer';
import { paymentsClient } from './integrations/m7-payments';
import { startConsumer, type RunningConsumer } from './messaging/consumer';
import { startOutboxRelay, type RunningRelay } from './messaging/outbox-relay';
import { PAYMENT_CONFIRMED_ROUTING_KEY, processPaymentConfirmed } from './messaging/payment-confirmed';
import { queueTopology } from './messaging/topology';
import type { IdentityValidator } from './middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestContext } from './middlewares/request-context.middleware';
import { checkReadiness, type DependencyChecks, type Readiness } from './observability/health';
import { createLogger, errorMessage } from './observability/logger';
import type { CircuitState } from './resilience/circuit-breaker';
import { createReceiptRouter } from './routes/receipt.routes';

const log = createLogger('server');

export interface ReceiptsModuleOptions {
  identityValidator?: IdentityValidator;
}

/**
 * RF-8.3 (y el reenvio de RF-8.4) como modulo montable en la aplicacion comun
 * de M8. El modulo no levanta servidor HTTP ni termina el proceso: eso queda
 * a cargo de quien lo monta.
 */
export interface ReceiptsModule {
  name: 'receipts';
  /**
   * Rutas propias, acotadas a `${API_PREFIX}/receipts` y `/internal/receipts`.
   * No incluye /health, /docs ni un 404 global, para no interferir con las
   * rutas de los demas modulos.
   */
  router: Router;
  /** Verificaciones de salud de las dependencias del modulo. */
  checks: DependencyChecks;
  /** Estado del modulo con el mismo criterio de /health/ready. */
  readiness(): Promise<Readiness & { circuits: Record<string, CircuitState> }>;
  /** Conecta Redis, prepara el esquema y arranca la mensajeria. No bloquea ni lanza. */
  start(): void;
  /** Libera conexiones sin terminar el proceso. */
  stop(): Promise<void>;
}

export function createReceiptsModule(options: ReceiptsModuleOptions = {}): ReceiptsModule {
  let closing = false;
  let schemaReady = false;
  let consumer: RunningConsumer | undefined;
  let relay: RunningRelay | undefined;

  const checks: DependencyChecks = {
    postgres: async () => schemaReady && (await isDatabaseReady()),
    redis: isRedisReady,
    rabbitmq: async () => Boolean(consumer?.isConnected() && relay?.isConnected()),
    fiscal: () => fiscalClient.isReachable(),
    payments: () => paymentsClient.isReachable(),
  };

  /**
   * Prepara el esquema reintentando hasta que PostgreSQL responda. El modulo no
   * falla si la base no esta disponible al arrancar: informa la base como no
   * disponible y se recupera solo cuando vuelve.
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
    // RF-8.6: la emision del comprobante se dispara de forma asincronica cuando
    // se confirma el pago. Si RabbitMQ no esta disponible, la API REST sigue
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

  const corsMiddleware = cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  const jsonBody = express.json({ limit: '256kb' });

  const internalRoutes = Router();
  internalRoutes.get('/:tripId/delivery-reference', getDeliveryReference);

  // Cada montaje termina en su propio 404 y manejador de errores: una ruta
  // desconocida bajo /receipts responde con el formato de error del servicio,
  // y las rutas de otros modulos nunca entran aca.
  const router = Router();
  router.use(
    `${env.apiPrefix}/receipts`,
    requestContext,
    corsMiddleware,
    jsonBody,
    createReceiptRouter(options.identityValidator),
    notFoundHandler,
    errorHandler,
  );
  router.use('/internal/receipts', requestContext, jsonBody, internalRoutes, notFoundHandler, errorHandler);

  return {
    name: 'receipts',
    router,
    checks,
    async readiness() {
      const readiness = await checkReadiness(checks);
      return { ...readiness, circuits: { fiscal: fiscalClient.circuitState() } };
    },
    start() {
      // Sin Redis el modulo arranca igual: solo quedan sin servicio los enlaces
      // temporales, y el cliente reintenta la conexion por su cuenta.
      void connectRedis().catch(() => undefined);

      void prepareDatabase().then((ready) => {
        if (ready) {
          schemaReady = true;
          startMessaging();
        }
      });
    },
    async stop() {
      closing = true;
      await Promise.all([consumer?.close(), relay?.close()]);
      await Promise.all([closePool(), closeRedis()]);
    },
  };
}
