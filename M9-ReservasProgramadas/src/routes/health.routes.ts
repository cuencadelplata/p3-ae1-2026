import { Router, type RequestHandler } from 'express';

import { getHealth } from '../controllers/health.controller.js';

export const createHealthRouter = (handler: RequestHandler = getHealth): Router => {
  const router = Router();
  router.get('/', handler);
  return router;
};
