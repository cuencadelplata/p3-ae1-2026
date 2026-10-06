import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 ignora la promesa que devuelve un handler async: si falla, nadie captura el error
 * (la request queda colgada y se produce un unhandled rejection).
 * Este wrapper envía cualquier error al middleware central de errores mediante next(error).
 */
export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
