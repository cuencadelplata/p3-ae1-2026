import express from 'express';

import { createSupportApp } from './app.js';
import { loadM1IdentityConfig, loadM6TripsConfig, loadSupportConfig, type SupportConfig } from './config/env.js';
import { loadDatabaseRetryMs, loadSupportDbConfig } from './db/config.js';
import { SupportDatabase } from './db/database.js';
import { createSupportPool } from './db/pool.js';
import { NoopSupportEventPublisher } from './events/support-event-publisher.js';
import { checkSupportReadiness, type ReadinessProbes } from './http/readiness.js';
import type { PenaltyRouteDeps } from './http/penalties.js';
import { createM1IdentityClient, type IdentityVerifier } from './integrations/m1-identity.js';
import { createM6TripsClient, type TripVerifier } from './integrations/m6-trips.js';
import { PostgresTicketRepository } from './repositories/postgres-ticket.repository.js';
import { PostgresPenaltyRepository } from './repositories/penalty.repository.js';
import type { TicketRepository } from './repositories/ticket.repository.js';
import { TicketService } from './services/ticket.service.js';

// Arma las dependencias de Support según la configuración. No abre puertos
// hasta que el entrypoint lo pide.
export function createSupportRuntime(
  _config: SupportConfig,
  ticketRepository: TicketRepository,
  database?: ReadinessProbes['database'],
  includeStandaloneHttpApp = true,
  // Sin verificador no se consulta a M6 al crear un ticket.
  tripVerifier?: TripVerifier,
  // Sin verificador de identidad /tickets no exige Bearer.
  identityVerifier?: IdentityVerifier,
  penalties?: PenaltyRouteDeps,
) {
  const ticketService = new TicketService(ticketRepository, new NoopSupportEventPublisher(), tripVerifier);
  const readiness = () =>
    checkSupportReadiness({
      database,
      trips: tripVerifier ? () => tripVerifier.isReachable() : undefined,
      identity: identityVerifier ? () => identityVerifier.isReachable() : undefined,
    });
  const app = includeStandaloneHttpApp
    ? createSupportApp({ ticketService, readiness, identityVerifier, penalties })
    : express();

  return {
    app,
    ticketService,
    readiness,
    identityVerifier,
    penalties,
  };
}

// Arma Support a partir de las variables de entorno, como lo hace el
// entrypoint. Los tickets se persisten en PostgreSQL y la base es obligatoria:
// sin SUPPORT_DATABASE_URL lanza y el proceso no arranca. El repositorio en
// memoria queda sólo para los tests. Crear el pool no abre conexiones.
export function buildSupportFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  includeStandaloneHttpApp = true,
) {
  const config = loadSupportConfig(env);
  const dbConfig = loadSupportDbConfig(env);
  const retryMs = loadDatabaseRetryMs(env);
  const m6Trips = loadM6TripsConfig(env);
  if (!m6Trips) {
    console.log('[Support] M6_TRIPS_URL no está definida: los tickets se crean sin verificar el viaje en M6.');
  }
  const m1Identity = loadM1IdentityConfig(env);
  if (!m1Identity) {
    console.log('[Support] SUPPORT_M1_IDENTITY_URL no está definida: /tickets no exige autenticación.');
  }

  const pool = createSupportPool(dbConfig.databaseUrl);
  const database = new SupportDatabase({ pool, schema: dbConfig.schema, retryMs });
  const ticketRepository = new PostgresTicketRepository(pool, dbConfig.schema);
  const tripsClient = m6Trips && createM6TripsClient(m6Trips);
  const runtime = createSupportRuntime(
    config,
    ticketRepository,
    database,
    includeStandaloneHttpApp,
    tripsClient,
    m1Identity && createM1IdentityClient(m1Identity),
    {
      repository: new PostgresPenaltyRepository(pool, dbConfig.schema),
      trips: tripsClient,
      internalKey: env.SUPPORT_PENALTIES_API_KEY,
    },
  );

  return { config, pool, database, ...runtime };
}
