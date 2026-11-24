import express, { Router } from 'express';

import { registerSupportRoutes } from './app.js';
import { correlationId } from './http/correlation.js';
import { supportErrorHandler } from './http/error-handler.js';
import type { SupportReadiness } from './http/readiness.js';
import { buildSupportFromEnv } from './support-runtime.js';

export interface SupportModule {
  name: 'support';
  router: Router;
  readiness(): Promise<SupportReadiness>;
  start(): void;
  stop(): Promise<void>;
}

export function createSupportModule(): SupportModule {
  // La app común aporta health, documentación y 404 globales; Support monta
  // solamente sus rutas y no necesita cargar una especificación propia.
  const support = buildSupportFromEnv(process.env, false);
  const router = Router();
  // Support parsea su propio JSON, sin depender del parser de otro módulo.
  // Acotado a /tickets para no leer cuerpos de otras rutas; un JSON mal
  // formado llega al manejador de abajo como SUPPORT_VALIDATION_ERROR.
  router.use('/tickets', correlationId, express.json());
  registerSupportRoutes(router, {
    ticketService: support.ticketService,
    readiness: support.readiness,
    identityVerifier: support.identityVerifier,
  });
  router.use('/tickets', supportErrorHandler);

  return {
    name: 'support',
    router,
    readiness: support.readiness,
    start() {
      void support.database.prepare();
    },
    async stop() {
      support.database.stop();
      await support.pool.end();
    },
  };
}
