import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import pino, { type DestinationStream, type Logger } from 'pino';

type RequestContext = {
  readonly requestId: string;
};

const requestContext = new AsyncLocalStorage<RequestContext>();
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const QUIET_PATHS = new Set(['/health', '/metrics']);

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function createLogger(destination: DestinationStream = process.stdout): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    mixin: () => {
      const requestId = getRequestId();
      return requestId === undefined ? {} : { requestId };
    },
    serializers: {
      err: pino.stdSerializers.err
    },
    redact: {
      paths: ['authorization', 'token', 'password', '*.authorization', '*.token', '*.password'],
      censor: '[Redacted]'
    }
  }, destination);
}

export const logger = createLogger();

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
};

export const requestLoggingMiddleware: RequestHandler = (req, res, next) => {
  if (QUIET_PATHS.has(req.path)) {
    next();
    return;
  }

  const startedAt = performance.now();
  const requestId = getRequestId();
  res.once('finish', () => {
    const fields = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2))
    };

    if (res.statusCode >= 500) {
      logger.error(fields, 'http.request.complete');
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn(fields, 'http.request.complete');
      return;
    }
    logger.info(fields, 'http.request.complete');
  });
  next();
};
