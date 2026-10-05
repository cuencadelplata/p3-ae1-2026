import type { RequestHandler } from 'express';
import { z } from 'zod';
import { m1AuthClient } from '../clients/m1-auth.client.js';

const BearerTokenSchema = z.string()
  .regex(/^Bearer [^\s]+$/i)
  .transform((authorization) => authorization.slice(authorization.indexOf(' ') + 1));

export type RequireAuthOptions = {
  readonly roles?: readonly string[];
};

export function requireAuth(options: RequireAuthOptions = {}): RequestHandler {
  return async (req, res, next) => {
    const authorization = BearerTokenSchema.safeParse(req.header('Authorization'));
    if (!authorization.success) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Se requiere un token Bearer válido'
      });
      return;
    }

    try {
      const identity = await m1AuthClient.validateToken(authorization.data);
      if (identity === null) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'El token es inválido o está vencido'
        });
        return;
      }

      if (options.roles !== undefined && !options.roles.includes(identity.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'El rol autenticado no tiene permiso para realizar esta operación'
        });
        return;
      }

      req.auth = {
        userId: identity.userId,
        role: identity.role,
        token: authorization.data
      };
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
