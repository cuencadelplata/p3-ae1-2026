import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { pdfDirectory } from './repositories/receipt.repository';
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

  // Solo se publica el directorio de PDF. Los metadatos viven en otra carpeta
  // para que nunca queden expuestos como archivos estaticos.
  app.use(
    env.staticPrefix,
    express.static(pdfDirectory, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'private, max-age=300');
      },
    }),
  );

  app.use(env.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
