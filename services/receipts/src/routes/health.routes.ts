import { Router } from 'express';

import { env } from '../config/env';
import { isDatabaseReady } from '../db/pool';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const databaseReady = await isDatabaseReady();

    res.status(databaseReady ? 200 : 503).json({
      status: databaseReady ? 'ok' : 'degraded',
      service: env.serviceName,
      version: env.serviceVersion,
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        database: databaseReady ? 'available' : 'unavailable',
      },
    });
  } catch (error) {
    next(error);
  }
});
