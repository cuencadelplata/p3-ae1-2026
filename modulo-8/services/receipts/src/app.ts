import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { apiRouter } from './routes';
import { healthRouter } from './routes/health.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((origin) => origin.trim()),
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));

  app.use('/health', healthRouter);
  app.get('/docs', (_req, res) => res.redirect(`${env.apiPrefix}/docs`));

  // Los PDF ya no se publican como archivos estaticos: la unica forma de
  // obtenerlos es a traves de la API.
  app.use(env.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
