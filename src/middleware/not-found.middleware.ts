import type { RequestHandler } from 'express';

import { AppError } from '../errors/app.error.js';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError(
      404,
      'RUTA_NO_ENCONTRADA',
      `No existe la ruta ${request.method} ${request.originalUrl}.`,
    ),
  );
};
