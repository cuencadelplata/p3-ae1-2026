import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface RequestContext {
  correlationId: string;
  authorization?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const runWithRequestContext = <T>(context: RequestContext, action: () => T): T =>
  storage.run(context, action);

export const correlationMiddleware: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-correlation-id')?.trim();
  const correlationId = supplied === undefined || supplied === '' ? randomUUID() : supplied;
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

export type RequestLogger = (entry: {
  correlationId: string;
  method: string;
  path: string;
  statusCode: number;
}) => void;

export const createRequestLoggingMiddleware =
  (logger: RequestLogger): RequestHandler =>
  (request, response, next) => {
    response.once('finish', () => {
      const correlationId = getRequestContext()?.correlationId;
      if (correlationId !== undefined) {
        logger({
          correlationId,
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
        });
      }
    });
    next();
  };
