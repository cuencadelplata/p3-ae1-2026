import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './config/env';
import { isRedisReady } from './cache/redis';
import { isDatabaseReady } from './db/pool';
import { fiscalClient } from './integrations/fiscal-authorizer';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestContext } from './middlewares/request-context.middleware';
import type { DependencyChecks } from './observability/health';
import { apiRouter } from './routes';
import { createHealthRouter } from './routes/health.routes';
import { internalRouter } from './routes/internal.routes';

export interface AppOptions {
  /**
   * Verificaciones de salud. RabbitMQ la aporta el proceso que corre el
   * consumidor y el relay; sin ella se informa como no disponible.
   */
  checks?: Partial<DependencyChecks>;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const checks: DependencyChecks = {
    postgres: isDatabaseReady,
    redis: isRedisReady,
    rabbitmq: async () => false,
    fiscal: () => fiscalClient.isReachable(),
    ...options.checks,
  };

  app.disable('x-powered-by');
  app.use(requestContext);

  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((origin) => origin.trim()),
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));

  app.use('/health', createHealthRouter(checks, () => ({ fiscal: fiscalClient.circuitState() })));
  app.get('/docs', (_req, res) => res.redirect(`${env.apiPrefix}/docs`));

  // Los PDF ya no se publican como archivos estaticos: la unica forma de
  // obtenerlos es a traves de la API.
  app.use(env.apiPrefix, apiRouter);
  app.use('/internal', internalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
