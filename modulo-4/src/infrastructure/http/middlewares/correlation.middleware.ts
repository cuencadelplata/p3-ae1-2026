import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { correlationStorage } from '../../logger/structured.logger.js';

// Acepta UUIDs y otros identificadores simples; evita reflejar valores arbitrarios en la respuesta y en los logs.
const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const resolveCorrelationId = (header: string | string[] | undefined): string => {
  const value = Array.isArray(header) ? header[0] : header;
  return value && VALID_CORRELATION_ID.test(value) ? value : randomUUID();
};

export const correlationMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = resolveCorrelationId(req.headers['x-correlation-id']);
  res.setHeader('X-Correlation-ID', correlationId);

  correlationStorage.run({ correlationId }, () => {
    next();
  });
};
