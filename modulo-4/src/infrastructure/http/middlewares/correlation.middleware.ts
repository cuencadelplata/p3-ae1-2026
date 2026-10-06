import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { correlationStorage } from '../../logger/structured.logger.js';

export const correlationMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);

  correlationStorage.run({ correlationId }, () => {
    next();
  });
};
