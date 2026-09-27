import { Router } from 'express';

import { env } from '../config/env';
import { isStorageWritable } from '../repositories/receipt.repository';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const storageReady = await isStorageWritable();

    res.status(storageReady ? 200 : 503).json({
      status: storageReady ? 'ok' : 'degraded',
      service: env.serviceName,
      version: env.serviceVersion,
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        storage: storageReady ? 'available' : 'unavailable',
      },
    });
  } catch (error) {
    next(error);
  }
});
