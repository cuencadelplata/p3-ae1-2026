import type { Request, Response, NextFunction } from 'express';
import {
  ServiceUnavailableError,
  isServiceUnavailableError,
  describeError,
  defaultRetryAfterSeconds
} from '../errors/service-unavailable.error.js';

/**
 * Middleware central de errores (C9): toda falla termina en una respuesta JSON controlada.
 * - Dependencia caída o timeout → 503 con Retry-After
 * - JSON mal formado → 400
 * - Cualquier otro error → 500 genérico, sin stack trace (el detalle queda solo en el log)
 */
export function errorHandler(error: any, req: Request, res: Response, next: NextFunction): void {
  // Si ya se empezó a enviar la respuesta, Express debe cerrar la conexión
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isServiceUnavailableError(error)) {
    const retryAfter = error instanceof ServiceUnavailableError ? error.retryAfter : defaultRetryAfterSeconds();
    console.warn(`[M2] 503 en ${req.method} ${req.originalUrl}: ${describeError(error)}`);
    res.set('Retry-After', String(retryAfter));
    res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'El servicio de clientes no está disponible temporalmente. Intente nuevamente más tarde.',
      retryAfter
    });
    return;
  }

  // Error de express.json() al recibir un body que no es JSON válido
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: 'ValidationError',
      message: 'El cuerpo de la petición no es un JSON válido'
    });
    return;
  }

  console.error(`[M2] Error no controlado en ${req.method} ${req.originalUrl}:`, error);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'Ocurrió un error inesperado'
  });
}
