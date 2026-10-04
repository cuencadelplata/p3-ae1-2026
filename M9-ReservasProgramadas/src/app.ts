import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from './docs/openapi.js';
import { errorHandler } from './middleware/error.middleware.js';
import {
  correlationMiddleware,
  createRequestLoggingMiddleware,
  type RequestLogger,
} from './integration/request-context.js';
import { notFoundHandler } from './middleware/not-found.middleware.js';
import type { ReadinessService } from './readiness/readiness.service.js';
import { healthRouter } from './routes/health.routes.js';
import { createReadinessRouter } from './routes/readiness.routes.js';
import { createReservaRouter } from './routes/reserva.routes.js';
import type { ReservaService } from './services/reserva.service.js';

export interface AppDependencies {
  reservaService?: ReservaService;
  readinessService?: ReadinessService;
  requestLogger?: RequestLogger;
}

export const createApp = ({
  reservaService,
  readinessService,
  requestLogger,
}: AppDependencies = {}) => {
  const application = express();

  application.disable('x-powered-by');
  application.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  application.use(cors());
  application.use(correlationMiddleware);
  if (requestLogger !== undefined) {
    application.use(createRequestLoggingMiddleware(requestLogger));
  }
  application.use(express.json());
  application.use(express.static(path.resolve('public')));

  application.use('/health', healthRouter);
  if (readinessService !== undefined) {
    application.use('/readiness', createReadinessRouter(readinessService));
  }
  application.get('/openapi.json', (_request, response) => response.json(openApiDocument));
  application.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  if (reservaService !== undefined) {
    application.use('/reservas', createReservaRouter(reservaService));
  }

  application.use(notFoundHandler);
  application.use(errorHandler);

  return application;
};

export const app = createApp();
