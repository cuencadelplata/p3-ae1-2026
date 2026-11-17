import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

import { normalizeMethod, normalizeRoute } from '../observability/http-telemetry.js';
import { isValidCorrelationId } from '../observability/redaction.js';

export interface RequestContext {
  correlationId: string;
  authorization?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const runWithRequestContext = <T>(context: RequestContext, action: () => T): T =>
  storage.run(context, action);

/**
 * Reutiliza `x-correlation-id` solo si es corto y de caracteres seguros (máx. 128,
 * [A-Za-z0-9._:-]); si no, genera uno nuevo para evitar inyección en logs.
 */
export const correlationMiddleware: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-correlation-id')?.trim();
  const correlationId = isValidCorrelationId(supplied) ? supplied : randomUUID();
  const authorization = request.header('authorization');
  response.setHeader('x-correlation-id', correlationId);
  storage.run(
    {
      correlationId,
      ...(authorization === undefined ? {} : { authorization }),
    },
    next,
  );
};

export interface RequestLogEntry {
  correlationId: string;
  method: string;
  /** Ruta normalizada (p. ej. `/reservas/:id`), sin UUID ni query string. */
  path: string;
  routeKind: string;
  statusCode: number;
  durationMs: number;
}

export type RequestLogger = (entry: RequestLogEntry) => void;

export const createRequestLoggingMiddleware =
  (logger: RequestLogger): RequestHandler =>
  (request, response, next) => {
    const startedAt = performance.now();
    response.once('finish', () => {
      const correlationId = getRequestContext()?.correlationId;
      if (correlationId !== undefined) {
        const { route, kind } = normalizeRoute(request.originalUrl, response.statusCode);
        logger({
          correlationId,
          method: normalizeMethod(request.method),
          path: route,
          routeKind: kind,
          statusCode: response.statusCode,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        });
      }
    });
    next();
  };
