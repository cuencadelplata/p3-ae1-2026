import type { ErrorRequestHandler } from 'express';

import { AppError } from '../errors/app.error.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
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
      codigo: 'ERROR_PERSISTENCIA',
      mensaje: 'Ocurrió un error interno.',
    },
  });
};
