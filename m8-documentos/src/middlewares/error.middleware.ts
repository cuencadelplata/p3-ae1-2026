import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError } from '../errors/app-error';

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

  // express.json() rechaza los cuerpos mal formados con un SyntaxError.
  if (error instanceof SyntaxError && 'body' in error) {
    res
      .status(400)
      .json(buildBody('MALFORMED_JSON', 'El cuerpo de la solicitud no es un JSON valido', req.originalUrl));
    return;
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  res
    .status(500)
    .json(
      buildBody('INTERNAL_ERROR', 'Ocurrio un error inesperado al procesar la solicitud', req.originalUrl),
    );
};
