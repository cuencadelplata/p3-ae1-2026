import express, { Router } from 'express';

import { errorHandler } from './http/error-handler';
import { requestContext } from './http/request-context';
import { createLogger } from './observability/logger';
import { generateQrDataUrl, generateQrToken } from './qr-generator';
import { loadQrConfig } from './qr.config';
import { createRedisQrStore } from './qr.redis-store';
import { createQrRouter } from './qr.controller';
import { createQrService } from './qr.service';
import { createQrRedisClient, isRedisReady } from './redis-client';

export interface QrModule {
  name: 'qr';
  router: Router;
  readiness(): Promise<{ status: 'ok' | 'unavailable'; dependencies: { redis: string } }>;
  start(): void;
  stop(): Promise<void>;
}

export function createQrModule(): QrModule {
  const config = loadQrConfig();
  if (config.redisUrl === undefined) {
    throw new Error('REDIS_URL es obligatoria para montar el módulo QR.');
  }

  const redis = createQrRedisClient({ url: config.redisUrl });
  const service = createQrService({
    store: createRedisQrStore({ client: redis, expiredGraceSeconds: config.expiredGraceSeconds }),
    config,
    generateQrToken,
    generateQrDataUrl,
    now: () => new Date(),
    log: createLogger('qr'),
  });
  const router = Router();
  router.use(requestContext, express.json(), createQrRouter(service), errorHandler);

  return {
    name: 'qr',
    router,
    async readiness() {
      const available = await isRedisReady(redis);
      return { status: available ? 'ok' : 'unavailable', dependencies: { redis: available ? 'available' : 'unavailable' } };
    },
    start() {
      void redis.connect().catch(() => undefined);
    },
    async stop() {
      if (redis.isReady) await redis.close();
      else if (redis.isOpen) redis.destroy();
    },
  };
}
