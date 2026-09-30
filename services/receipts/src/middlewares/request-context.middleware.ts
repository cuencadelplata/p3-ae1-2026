import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler } from 'express';

import { createLogger, withCorrelationId } from '../observability/logger';

export const CORRELATION_HEADER = 'X-Correlation-Id';
const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const log = createLogger('http');

/** Ruta sin query string y sin el token de los enlaces de descarga. */
function loggablePath(req: Request): string {
  const [path = ''] = req.originalUrl.split('?');
  return path.replace(/(\/downloads\/)[^/]+/, '$1:token');
}

/**
 * Asigna un correlationId a cada solicitud: el que envia el cliente en
 * X-Correlation-Id o uno nuevo. Se devuelve en la respuesta y se incluye en
 * todos los logs de la solicitud, incluida una linea final con el resultado.
 *
 * Las consultas de salud exitosas no se registran: Docker las hace cada pocos
 * segundos y taparian el resto de los logs.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  const correlationId = incoming && VALID_CORRELATION_ID.test(incoming) ? incoming : randomUUID();
  const startedAt = performance.now();

  res.setHeader(CORRELATION_HEADER, correlationId);
  res.on('finish', () => {
    if (req.path.startsWith('/health') && res.statusCode < 400) {
      return;
    }
    withCorrelationId(correlationId, () =>
      log(res.statusCode >= 500 ? 'error' : 'info', 'solicitud atendida', {
        method: req.method,
        path: loggablePath(req),
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });

  withCorrelationId(correlationId, next);
};
