import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { authenticate } from './auth';
import { ApiError } from './domain';
import { router as direcciones } from './routes';
import ratings from '../routes/calificacion.routes';

/**
 * Rutas de RF-2.2 (direcciones frecuentes) y RF-2.4 (calificación del conductor),
 * integradas en la API de M2. Conservan su formato de respuesta y de error
 * ({ status, code, message, correlationId }); los errores que no son propios
 * (por ejemplo M1 caído → 503) siguen al manejador central de M2.
 */
const correlation: RequestHandler = (req, res, next) => {
  const proposed = req.get('x-correlation-id');
  res.locals.correlationId = proposed && /^[a-zA-Z0-9_-]{1,100}$/.test(proposed) ? proposed : randomUUID();
  res.set('x-correlation-id', res.locals.correlationId);
  next();
};

const errors: ErrorRequestHandler = (err, _req, res, next) => {
  let status: number, code: string, message: string;
  if (err instanceof ApiError) ({ status, code, message } = err);
  else if (err instanceof ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = 'Datos inválidos'; }
  else if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err?.code)) { status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'Persistencia no disponible'; }
  else return next(err);
  res.status(status).json({
    status: 'error', code, message, correlationId: res.locals.correlationId,
    ...(err instanceof ZodError ? { errors: err.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) } : {})
  });
};

/** /api/v1/direcciones…, /api/v1/geocodificacion y /api/v1/calificaciones… */
export const ae2Api = Router();
ae2Api.use(correlation, authenticate, direcciones, ratings);
ae2Api.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Ruta no encontrada')));
ae2Api.use(errors);

/** Rutas heredadas de RF-2.4 sin prefijo (/calificaciones…), ahora autenticadas. */
export const ae2Legacy = Router();
ae2Legacy.use('/calificaciones', correlation, authenticate);
ae2Legacy.use(ratings);
ae2Legacy.use(errors);
