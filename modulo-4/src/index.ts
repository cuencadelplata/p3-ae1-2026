import { TripEventHandler } from './application/event-handlers/trip-event.handler.js';
import { createApp } from './app.js';
import { config } from './infrastructure/config/env.config.js';
import { M1AuthAdapter } from './infrastructure/auth/m1-auth.adapter.js';
import { Logger } from './infrastructure/logger/structured.logger.js';
import { PostgresLocationHistoryRepository } from './infrastructure/postgres/postgres-location-history.repository.js';
import { RabbitMQEventPublisher } from './infrastructure/rabbitmq/rabbitmq-event.publisher.js';
import { RabbitMQTripEventConsumer } from './infrastructure/rabbitmq/rabbitmq-trip-event.consumer.js';
import { RabbitMQConnection } from './infrastructure/rabbitmq/rabbitmq.connection.js';
import { MemoryLocationRepository } from './infrastructure/redis/memory-location.repository.js';
import { RedisEventStore } from './infrastructure/redis/redis-event-store.js';
import { RedisLocationRepository } from './infrastructure/redis/redis-location.repository.js';

async function bootstrap() {
  Logger.info(`Iniciando M4 - Servicio de Ubicación y Disponibilidad v2.0.0 (ENV: ${config.nodeEnv})`, {
    m1Url: config.m1Url,
    m3Url: config.m3Url,
    postgresUrl: config.postgresUrl,
    redisKeyPrefix: config.redisKeyPrefix
  });

  // Repositorio de Ubicación Redis (o Memory fallback)
  const locationRepository = config.redisUrl
    ? new RedisLocationRepository(config.redisUrl, config.redisKeyPrefix)
    : new MemoryLocationRepository();

  // Repositorio de Historial PostgreSQL
  const historyRepository = new PostgresLocationHistoryRepository(config.postgresUrl);

  // Adaptador de Autenticación M1
  const authService = new M1AuthAdapter(config.m1Url, config.skipAuthValidation);

  // Almacén de Idempotencia Redis
  const eventStore = new RedisEventStore(config.redisUrl);

  // Conexión RabbitMQ
  const rabbitmqConnection = new RabbitMQConnection(config.rabbitmqUrl);
  await rabbitmqConnection.connect();

  // Publicador y Consumidor de Eventos RabbitMQ
  const eventPublisher = new RabbitMQEventPublisher(rabbitmqConnection);
  const tripEventHandler = new TripEventHandler(locationRepository, eventPublisher);
  const tripEventConsumer = new RabbitMQTripEventConsumer(
    rabbitmqConnection,
    tripEventHandler,
    eventStore
  );

  // Iniciar consumidor de eventos de viaje en segundo plano
  tripEventConsumer.startConsuming().catch((err) => {
    Logger.error('Falla al iniciar consumidor de eventos de viaje RabbitMQ', err);
  });

  // Crear aplicación Express
  const app = createApp({
    locationRepository,
    historyRepository,
    authService,
    eventPublisher,
    rabbitmqConnection
  });

  const server = app.listen(config.port, () => {
    Logger.info(`Servidor HTTP M4 escuchando en el puerto ${config.port}`, {
      port: config.port,
      docs: `http://localhost:${config.port}/docs`,
      liveness: `http://localhost:${config.port}/health/liveness`,
      readiness: `http://localhost:${config.port}/health/readiness`
    });
  });

  // Cierre controlado (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    Logger.warn(`Señal ${signal} recibida. Apagando servicio M4 ordenadamente...`);
    server.close(async () => {
      await rabbitmqConnection.close();
      Logger.info('Servicio M4 apagado completamente.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  Logger.error('Falla fatal al iniciar la aplicación M4', error);
  process.exit(1);
});
