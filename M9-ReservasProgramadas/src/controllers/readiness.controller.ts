import type { RequestHandler } from 'express';

import type { ReadinessService } from '../readiness/readiness.service.js';

export const createGetReadiness =
  (service: ReadinessService): RequestHandler =>
  async (_request, response) => {
    const result = await service.check();
    response.status(result.status === 'ready' ? 200 : 503).json(result);
  };
