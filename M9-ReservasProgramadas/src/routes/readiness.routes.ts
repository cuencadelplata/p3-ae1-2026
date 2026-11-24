import { Router } from 'express';

import { createGetReadiness } from '../controllers/readiness.controller.js';
import type { ReadinessService } from '../readiness/readiness.service.js';

export const createReadinessRouter = (service: ReadinessService): Router => {
  const router = Router();
  router.get('/', createGetReadiness(service));
  return router;
};
