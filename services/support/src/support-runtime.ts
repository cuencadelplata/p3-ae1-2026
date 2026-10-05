import { createSupportApp } from './app.js';
import { loadSupportConfig, type SupportConfig } from './config/env.js';
import { loadDatabaseRetryMs, loadSupportDbConfig } from './db/config.js';
import { SupportDatabase } from './db/database.js';
import { createSupportPool } from './db/pool.js';
import {
  LegacyRabbitSupportEventPublisher,
  NoopSupportEventPublisher,
} from './events/support-event-publisher.js';
import { checkSupportReadiness, type ReadinessProbes } from './http/readiness.js';
import { RabbitMQConsumer } from './rabbitmq/consumer.js';
import { PostgresTicketRepository } from './repositories/postgres-ticket.repository.js';
import type { TicketRepository } from './repositories/ticket.repository.js';
import { TicketService } from './services/ticket.service.js';

// Arma las dependencias de Support según la configuración. No abre puertos
// ni conecta al broker hasta que el entrypoint lo pide.
export function createSupportRuntime(
  config: SupportConfig,
  ticketRepository: TicketRepository,
  database?: ReadinessProbes['database'],
) {
  const eventPublisher = config.legacyEvents
    ? new LegacyRabbitSupportEventPublisher()
    : new NoopSupportEventPublisher();
  const ticketService = new TicketService(ticketRepository, eventPublisher);
  const readiness = () =>
    checkSupportReadiness({
      database,
      legacyBroker: config.legacyEvents ? () => RabbitMQConsumer.isConnected() : undefined,
    });
  const app = createSupportApp({ ticketService, legacyEvents: config.legacyEvents, readiness });

  return {
    app,
    readiness,

    // Inicia el consumo asíncrono (RF-8.6) sólo si lo heredado de AE1 está habilitado.
    async startLegacyEvents() {
      if (!config.legacyEvents) return;
      await RabbitMQConsumer.connect(config.rabbitUrl);
    },
  };
}

// Arma Support a partir de las variables de entorno, como lo hace el
// entrypoint. Los tickets se persisten en PostgreSQL y la base es obligatoria:
// sin SUPPORT_DATABASE_URL lanza y el proceso no arranca. El repositorio en
// memoria queda sólo para los tests. Crear el pool no abre conexiones.
export function buildSupportFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const config = loadSupportConfig(env);
  const dbConfig = loadSupportDbConfig(env);
  const retryMs = loadDatabaseRetryMs(env);

  const pool = createSupportPool(dbConfig.databaseUrl);
  const database = new SupportDatabase({ pool, schema: dbConfig.schema, retryMs });
  const ticketRepository = new PostgresTicketRepository(pool, dbConfig.schema);
  const runtime = createSupportRuntime(config, ticketRepository, database);

  return { config, pool, database, ...runtime };
}
