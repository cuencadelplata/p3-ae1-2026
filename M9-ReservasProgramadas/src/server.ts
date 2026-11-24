// Debe ser el primer import: crea los proveedores OpenTelemetry antes que cualquier módulo.
import { telemetry, telemetryEnabled } from './observability/register.js';

import { createAuthentication } from './middleware/auth.middleware.js';
import { createApp } from './app.js';
import { DelegatedDispatchTokenProvider } from './clients/delegated-dispatch-token.provider.js';
import { EnvironmentTokenProvider, M5DispatchClient } from './clients/m5-dispatch.client.js';
import { M7TariffClient } from './clients/m7-tariff.client.js';
import { M4RouteResolver } from './clients/m4-route.resolver.js';
import { env } from './config/env.js';
import { ExternalServiceError } from './errors/external-service.error.js';
import { RedisReservationCache } from './cache/redis-reservation-cache.js';
import { RedisConnection } from './infrastructure/redis/redis.connection.js';
import { RabbitMqConnection } from './infrastructure/rabbitmq/rabbitmq.connection.js';
import { PrismaConnection } from './infrastructure/prisma/prisma.connection.js';
import { runWithRequestContext } from './integration/request-context.js';
import { ReservasScheduler } from './jobs/reservas.scheduler.js';
import { RedisDistributedLock } from './locks/redis-distributed-lock.js';
import { log, safeErrorContext } from './logging/logger.js';
import { OutboxProcessor } from './messaging/outbox.processor.js';
import { OutboxWorker } from './messaging/outbox.worker.js';
import { RabbitMqConsumer } from './messaging/rabbitmq-consumer.js';
import { RabbitMqEventPublisher } from './messaging/rabbitmq-event-publisher.js';
import {
  dispatchResultEventSchema,
  RESERVATION_EVENT_TYPES,
} from './messaging/reservation-events.js';
import { ReadinessService } from './readiness/readiness.service.js';
import { PrismaDispatchOperationStore } from './repositories/prisma-dispatch-operation.store.js';
import { PrismaDispatchResultProcessor } from './repositories/prisma-dispatch-result.processor.js';
import { PrismaOutboxRepository } from './repositories/prisma-outbox.repository.js';
import { PrismaReservaRepository } from './repositories/prisma-reserva.repository.js';
import { ActivacionReservaService } from './services/activacion-reserva.service.js';
import { ReservaService } from './services/reserva.service.js';
import { BlockedRouteResolver } from './integration/route-estimate.port.js';
import { ConfigurableStubRouteResolver } from './stubs/configurable-route-resolver.js';
import { telemetryConfig } from './observability/config.js';
import { StateMetricsCollector } from './observability/state-collector.js';
import { createDatabaseStateQuery } from './repositories/prisma-observability.queries.js';

const postgres = new PrismaConnection(env.DATABASE_URL);
const repository = new PrismaReservaRepository(postgres.client);
const redis = new RedisConnection(env.REDIS_URL, (error) =>
  log('error', 'redis_connection_error', { component: 'redis', ...safeErrorContext(error) }),
);
const rabbitMq = new RabbitMqConnection(
  env.RABBITMQ_URL,
  {
    exchange: env.RABBITMQ_EXCHANGE,
    retryExchange: env.RABBITMQ_RETRY_EXCHANGE,
    deadLetterExchange: env.RABBITMQ_DLQ_EXCHANGE,
    queue: env.RABBITMQ_QUEUE,
    retryQueue: env.RABBITMQ_RETRY_QUEUE,
    deadLetterQueue: env.RABBITMQ_DLQ,
    retryDelayMs: env.RABBITMQ_RETRY_DELAY_MS,
  },
  (error) =>
    log('error', 'rabbitmq_connection_error', {
      component: 'rabbitmq',
      ...safeErrorContext(error),
    }),
);
const cache = new RedisReservationCache(redis.client, env.REDIS_CACHE_TTL_SECONDS, (error) =>
  log('warn', 'redis_cache_error', { component: 'cache', ...safeErrorContext(error) }),
);
const distributedLock = new RedisDistributedLock(redis.client, env.REDIS_LOCK_TTL_MS);

const routeResolver =
  env.ROUTE_RESOLVER_MODE === 'stub'
    ? new ConfigurableStubRouteResolver({
        originLatitude: env.ROUTE_STUB_ORIGIN_LATITUDE,
        originLongitude: env.ROUTE_STUB_ORIGIN_LONGITUDE,
        destinationLatitude: env.ROUTE_STUB_DESTINATION_LATITUDE,
        destinationLongitude: env.ROUTE_STUB_DESTINATION_LONGITUDE,
        distanceKm: env.ROUTE_STUB_DISTANCE_KM,
        estimatedDurationMin: env.ROUTE_STUB_DURATION_MIN,
      })
    : env.ROUTE_RESOLVER_MODE === 'm4'
      ? new M4RouteResolver(env.M4_BASE_URL, env.M4_TIMEOUT_MS)
      : new BlockedRouteResolver();
const dispatchClient = new M5DispatchClient(
  env.M5_BASE_URL,
  env.M5_TIMEOUT_MS,
  env.M5_DEMO_CLIENT_ID
    ? new EnvironmentTokenProvider(env.M5_SERVICE_TOKEN)
    : new DelegatedDispatchTokenProvider(
        env.M9_DISPATCH_AUTH_URL,
        env.M9_DISPATCH_AUTH_TOKEN,
        env.M1_BASE_URL,
        env.M1_TIMEOUT_MS,
      ),
  new PrismaDispatchOperationStore(postgres.client),
  env.M5_DEMO_CLIENT_ID,
);

const reservaService = new ReservaService(
  repository,
  new M7TariffClient(env.M7_BASE_URL, env.M7_TIMEOUT_MS),
  routeResolver,
  cache,
  distributedLock,
  dispatchClient,
  env.M5_DEMO_CLIENT_ID,
);
const activacionService = new ActivacionReservaService(
  repository,
  dispatchClient,
  routeResolver,
  cache,
  distributedLock,
  env.DISPATCH_MODE,
  env.M5_DEMO_CLIENT_ID,
  env.ACTIVATION_RECOVERY_TIMEOUT_MS,
);
const scheduler = new ReservasScheduler(
  repository,
  activacionService,
  env.RESERVATION_JOB_INTERVAL,
  (error) =>
    log('error', 'reservation_scheduler_error', {
      ...safeErrorContext(error),
      ...(error instanceof ExternalServiceError
        ? {
            dependency: error.service,
            code: error.code,
            kind: error.kind,
            statusCode: error.statusCode,
          }
        : {}),
    }),
  env.SCHEDULER_CONCURRENCY,
  env.M5_DEMO_CLIENT_ID,
);
const readinessService = new ReadinessService([
  { name: 'postgres', check: () => postgres.ping() },
  { name: 'redis', check: () => redis.ping() },
  { name: 'rabbitmq', check: () => rabbitMq.ping() },
]);
const app = createApp({
  authenticate: createAuthentication({
    mode: env.M9_AUTH_MODE,
    m1BaseUrl: env.M1_BASE_URL,
    timeoutMs: env.M1_TIMEOUT_MS,
    demoSecret: env.M9_DEMO_AUTH_SECRET,
  }),
  reservaService,
  readinessService,
  requestLogger: (entry) => log('info', 'http_request', { ...entry }),
});

const eventPublisher = new RabbitMqEventPublisher(rabbitMq);
const outboxWorker = new OutboxWorker(
  new OutboxProcessor(
    new PrismaOutboxRepository(postgres.client),
    eventPublisher,
    env.RABBITMQ_RETRY_LIMIT,
    env.RABBITMQ_RETRY_DELAY_MS,
  ),
  env.OUTBOX_POLL_INTERVAL_MS,
  (error) => log('error', 'outbox_worker_error', safeErrorContext(error)),
);
const dispatchResultProcessor = new PrismaDispatchResultProcessor(postgres.client);

// Recolector de estado agregado (backlog, colas, salud). Solo corre con telemetría activa
// para no agregar consultas periódicas cuando nadie las exporta.
const stateCollector = new StateMetricsCollector({
  intervalMs: telemetryConfig().stateCollectorIntervalMs,
  database: createDatabaseStateQuery(
    postgres.client,
    telemetryConfig().stuckActivationThresholdSeconds,
  ),
  queues: async () => {
    const channel = rabbitMq.getChannel();
    const { queue, retryQueue, deadLetterQueue } = rabbitMq.topology;
    const roles: Array<[string, string]> = [
      [queue, 'main'],
      [retryQueue, 'retry'],
      [deadLetterQueue, 'dead_letter'],
    ];
    return Promise.all(
      roles.map(async ([name, role]) => {
        const info = await channel.checkQueue(name);
        return { queue: name, role, messages: info.messageCount, consumers: info.consumerCount };
      }),
    );
  },
  dependencies: [
    { name: 'postgres', check: () => postgres.ping() },
    { name: 'redis', check: () => redis.ping() },
    { name: 'rabbitmq', check: () => rabbitMq.ping() },
  ],
  onError: (source, error) =>
    log('warn', 'state_collector_failed', {
      component: 'telemetry',
      source,
      ...safeErrorContext(error),
    }),
});
const resultConsumer = new RabbitMqConsumer(rabbitMq, env.RABBITMQ_RETRY_LIMIT);

const startRabbitConsumer = async (): Promise<void> => {
  await rabbitMq.connect();
  await resultConsumer.start(
    [RESERVATION_EVENT_TYPES.rideAssigned, RESERVATION_EVENT_TYPES.rideFailed],
    async (rawEvent) => {
      const event = dispatchResultEventSchema.parse(rawEvent);
      await runWithRequestContext({ correlationId: event.correlationId }, async () => {
        const result = await dispatchResultProcessor.process(event);
        await cache.invalidate(event.payload.reservationId);
        log('info', 'dispatch_result_processed', {
          eventId: event.eventId,
          reservaId: event.payload.reservationId,
          requestId: event.payload.requestId,
          result,
        });
      });
    },
  );
};

const start = async (): Promise<void> => {
  await postgres.connect();
  await Promise.allSettled([redis.connect(), startRabbitConsumer()]);

  const reconnectTask = setInterval(() => {
    void redis
      .connect()
      .catch((error) => log('error', 'redis_reconnect_failed', safeErrorContext(error)));
    void startRabbitConsumer().catch((error) =>
      log('error', 'rabbitmq_reconnect_failed', safeErrorContext(error)),
    );
  }, 5_000);

  const server = app.listen(env.PORT, () => {
    log('info', 'service_started', { component: 'http', port: env.PORT });
  });
  scheduler.start();
  outboxWorker.start();
  if (telemetryEnabled) stateCollector.start();

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    scheduler.stop();
    outboxWorker.stop();
    stateCollector.stop();
    clearInterval(reconnectTask);
    server.close(() => {
      void Promise.allSettled([redis.close(), rabbitMq.close(), postgres.close()]).then(() =>
        // Flush final con plazo acotado (OTEL_SHUTDOWN_TIMEOUT_MS): nunca bloquea la salida.
        telemetry.shutdown(),
      );
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

void start().catch((error) => {
  log('error', 'service_start_failed', safeErrorContext(error));
  process.exitCode = 1;
});
