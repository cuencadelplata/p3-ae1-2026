import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'X-Correlation-Id';

const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// Asigna un correlationId a cada solicitud: el de X-Correlation-Id si viene y
// es válido, o uno nuevo. Se devuelve como cabecera en toda respuesta.
export function correlationId(req: Request, res: Response, next: NextFunction) {
  if (!res.locals.correlationId) {
    const incoming = req.get(CORRELATION_HEADER);
    const id = incoming && VALID_CORRELATION_ID.test(incoming) ? incoming : randomUUID();

    res.locals.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
  }
  next();
}
