import type { ErrorRequestHandler, Response } from 'express';
import { SupportError, validationError } from '../errors/support-error.js';

function isMalformedJsonError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { type?: unknown }).type === 'entity.parse.failed';
}

function sendError(res: Response, error: SupportError) {
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    correlationId: res.locals.correlationId,
  });
}

// Convierte cualquier error en la respuesta { error: { code, message,
// details? }, correlationId }. El stack nunca sale en la respuesta.
export const supportErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof SupportError) {
    if (error.code === 'SUPPORT_DB_UNAVAILABLE') {
      const cause = error.cause instanceof Error ? error.cause.message : String(error.cause ?? 'sin detalle');
      console.error('[Support] Base de datos no disponible:', { correlationId: res.locals.correlationId, cause });
    }
    sendError(res, error);
    return;
  }

  if (isMalformedJsonError(error)) {
    sendError(res, validationError([{ field: 'body', reason: 'El JSON no es válido.' }]));
    return;
  }

  console.error('[Support] Error no controlado:', {
    correlationId: res.locals.correlationId,
    stack: error instanceof Error ? error.stack : String(error),
  });
  sendError(res, new SupportError(500, 'SUPPORT_INTERNAL_ERROR', 'No fue posible procesar la solicitud.'));
};
