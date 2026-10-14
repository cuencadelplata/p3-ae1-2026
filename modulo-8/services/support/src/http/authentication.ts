import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { authRequired, invalidToken } from '../errors/support-error.js';
import type { IdentityVerifier } from '../integrations/m1-identity.js';

// El esquema no distingue mayúsculas (RFC 7235); un solo espacio y un token
// sin espacios.
const BEARER = /^bearer (\S+)$/i;

// Actor que queda en el historial cuando el pedido está autenticado por M1.
export function actorDeM1(userId: number): string {
  return `m1:${userId}`;
}

// Exige un Bearer válido según M1. Deja en res.locals el usuario y el actor
// que los handlers usan en lugar de X-Actor-Id.
export function authenticateWithM1(identityVerifier: IdentityVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.get('Authorization');
    if (!authorization) {
      throw authRequired();
    }
    // Un formato que no es Bearer no se consulta a M1.
    const token = BEARER.exec(authorization)?.[1];
    if (!token) {
      throw invalidToken();
    }

    // M1 sólo acepta "Bearer" con mayúscula inicial: se reenvía normalizado.
    const usuario = await identityVerifier.verificar(`Bearer ${token}`);
    res.locals.usuarioAutenticado = usuario;
    res.locals.actor = actorDeM1(usuario.userId);
    next();
  };
}
