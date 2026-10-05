import type { ErrorRequestHandler, RequestHandler } from 'express';

import { isDatabaseUnavailable } from '../db/errors';
import { AppError } from '../errors/app-error';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import { FiscalAuthorizationRejectedError } from '../integrations/fiscal-authorizer';
import { PaymentNotAuthorizedError } from '../integrations/m7-payments';
import { createLogger, errorFields, errorMessage } from '../observability/logger';

const log = createLogger('http');

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    path: string;
    timestamp: string;
  };
}

function buildBody(code: string, message: string, path: string, details?: unknown): ErrorBody {
  const body: ErrorBody = {
    error: { code, message, path, timestamp: new Date().toISOString() },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return body;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json(
      buildBody('ROUTE_NOT_FOUND', `La ruta ${req.method} ${req.originalUrl} no existe`, req.originalUrl),
    );
};

/** Formato de error unificado para todas las respuestas del servicio (RNF-05). */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json(buildBody(error.code, error.message, req.originalUrl, error.details));
    return;
  }

  // Una dependencia caida no es un error inesperado del servicio: se responde
  // 503 con Retry-After para que el cliente sepa que puede repetir el pedido.
  const unavailable = isDatabaseUnavailable(error)
    ? new DependencyUnavailableError('postgres', 'La base de datos no esta disponible. Intente nuevamente mas tarde.')
    : error instanceof DependencyUnavailableError
      ? error
      : null;
  if (unavailable) {
    log('warn', 'dependencia no disponible', {
      method: req.method,
      dependency: unavailable.dependency,
      reason: errorMessage(unavailable.cause ?? error),
    });
    res.setHeader('Retry-After', String(unavailable.retryAfterSeconds));
    res.status(503).json(buildBody(unavailable.code, unavailable.message, req.originalUrl));
    return;
  }

  // Pendiente o sin registrar se puede repetir mas tarde (409); un pago
  // rechazado por M7 no genera comprobante (422).
  if (error instanceof PaymentNotAuthorizedError) {
    if (error.retryable) {
      res.setHeader('Retry-After', '5');
    }
    res.status(error.retryable ? 409 : 422).json(buildBody(error.code, error.message, req.originalUrl));
    return;
  }

  if (error instanceof FiscalAuthorizationRejectedError) {
    res
      .status(422)
      .json(
        buildBody('FISCAL_AUTHORIZATION_REJECTED', 'El autorizador fiscal rechazo el comprobante', req.originalUrl, {
          code: error.code,
          message: error.message,
        }),
      );
    return;
  }

  // express.json() rechaza los cuerpos mal formados con un SyntaxError.
  if (error instanceof SyntaxError && 'body' in error) {
    res
      .status(400)
      .json(buildBody('MALFORMED_JSON', 'El cuerpo de la solicitud no es un JSON valido', req.originalUrl));
    return;
  }

  log('error', 'error inesperado al atender la solicitud', { method: req.method, ...errorFields(error) });
  res
    .status(500)
    .json(
      buildBody('INTERNAL_ERROR', 'Ocurrio un error inesperado al procesar la solicitud', req.originalUrl),
    );
};
