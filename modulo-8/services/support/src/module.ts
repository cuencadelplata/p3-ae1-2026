import { Router } from 'express';

import { registerLegacyEventRoutes, registerSupportRoutes } from './app.js';
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
  registerSupportRoutes(router, {
    ticketService: support.ticketService,
    legacyEvents: support.config.legacyEvents,
    readiness: support.readiness,
  });
  if (support.config.legacyEvents) registerLegacyEventRoutes(router);

  return {
    name: 'support',
    router,
    readiness: support.readiness,
    start() {
      void support.database.prepare();
      void support.startLegacyEvents();
    },
    async stop() {
      support.database.stop();
      await support.pool.end();
    },
  };
}
