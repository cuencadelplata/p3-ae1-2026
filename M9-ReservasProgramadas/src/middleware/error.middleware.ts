import type { ErrorRequestHandler } from 'express';

import { AppError } from '../errors/app.error.js';

const databaseUnavailableCodes = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

const isDatabaseUnavailable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : 'errorCode' in error ? error.errorCode : undefined;
  return typeof code === 'string' && databaseUnavailableCodes.has(code);
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (isDatabaseUnavailable(error)) {
    response.status(503).json({
      error: {
        codigo: 'BASE_DATOS_NO_DISPONIBLE',
        mensaje: 'La base de datos no está disponible. Reintente la operación.',
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        codigo: error.code,
        mensaje: error.message,
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      codigo: 'ERROR_INTERNO',
      mensaje: 'Ocurrió un error interno.',
    },
  });
};
