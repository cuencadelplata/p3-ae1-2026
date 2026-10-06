import type { NextFunction, Request, Response } from 'express';
import {
  ForbiddenError,
  GeocodingNotFoundError,
  GeocodingProviderError,
  GeocodingTimeoutError,
  InvalidCoordinatesError,
  LocationValidationError,
  NotFoundError,
  StaleLocationError,
  UnauthorizedError
} from '../../../domain/errors/location.errors.js';
import { Logger } from '../../logger/structured.logger.js';

export const errorHandlerMiddleware = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  Logger.error(`Error procesando solicitud HTTP: ${error.message}`, error);

  if (error instanceof UnauthorizedError) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: error.message
    });
    return;
  }

  if (error instanceof ForbiddenError) {
    res.status(403).json({
      code: 'FORBIDDEN',
      error: 'Forbidden',
      message: error.message
    });
    return;
  }

  if (error instanceof NotFoundError || error instanceof GeocodingNotFoundError) {
    res.status(404).json({
      code: 'NOT_FOUND',
      error: 'Not Found',
      message: error.message
    });
    return;
  }

  if (error instanceof StaleLocationError) {
    res.status(409).json({
      code: 'STALE_LOCATION_UPDATE',
      error: 'Conflict',
      message: error.message
    });
    return;
  }

  if (error instanceof InvalidCoordinatesError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      error: 'Bad Request',
      message: error.message
    });
    return;
  }

  if (error instanceof LocationValidationError) {
    res.status(400).json({
      code: 'LOCATION_VALIDATION_ERROR',
      error: 'Bad Request',
      message: error.message
    });
    return;
  }

  if (error instanceof GeocodingTimeoutError) {
    res.status(504).json({
      code: 'GEOCODING_TIMEOUT',
      error: 'Gateway Timeout',
      message: error.message
    });
    return;
  }

  if (error instanceof GeocodingProviderError) {
    res.status(502).json({
      code: 'GEOCODING_PROVIDER_ERROR',
      error: 'Bad Gateway',
      message: error.message
    });
    return;
  }

  res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    error: 'Internal Server Error',
    message: 'Ha ocurrido un error interno no esperado'
  });
};
