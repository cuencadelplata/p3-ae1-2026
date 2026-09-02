import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors/app.error.js';
import { errorHandler } from '../../src/middleware/error.middleware.js';
import { notFoundHandler } from '../../src/middleware/not-found.middleware.js';

describe('middleware de errores', () => {
  it('responde con AppError usando status y codigo esperados', () => {
    const json = vi.fn();
    const response = {
      status: vi.fn().mockReturnValue({ json }),
    } as unknown as Response;

    const error = new AppError(404, 'RUTA_NO_ENCONTRADA', 'No existe la ruta');
    errorHandler(error, {} as Request, response, vi.fn() as NextFunction);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: {
        codigo: 'RUTA_NO_ENCONTRADA',
        mensaje: 'No existe la ruta',
      },
    });
  });

  it('responde con 500 para errores no controlados', () => {
    const json = vi.fn();
    const response = {
      status: vi.fn().mockReturnValue({ json }),
    } as unknown as Response;

    errorHandler(new Error('boom'), {} as Request, response, vi.fn() as NextFunction);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        codigo: 'ERROR_PERSISTENCIA',
        mensaje: 'Ocurrió un error interno.',
      },
    });
  });
});

describe('not found middleware', () => {
  it('crea un AppError con la ruta solicitada', () => {
    const next = vi.fn();
    const request = {
      method: 'GET',
      originalUrl: '/ruta-inexistente',
    } as Request;

    notFoundHandler(request, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('RUTA_NO_ENCONTRADA');
    expect(error.message).toContain('/ruta-inexistente');
  });
});
