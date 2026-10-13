import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { authRequired, invalidToken } from '../errors/support-error.js';
import type { IdentityVerifier } from '../integrations/m1-identity.js';

const BEARER = /^Bearer\s+\S+$/;

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
    if (!BEARER.test(authorization)) {
      throw invalidToken();
    }

    const usuario = await identityVerifier.verificar(authorization);
    res.locals.usuarioAutenticado = usuario;
    res.locals.actor = actorDeM1(usuario.userId);
    next();
  };
}
