import { timingSafeEqual } from 'node:crypto';
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

/** Compara en tiempo constante; sin clave configurada no acepta ninguna. */
function matchesSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || provided === undefined) return false;
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function isValidServiceKey(provided: string | undefined): boolean {
  return matchesSecret(provided, process.env.STATUS_SECRET_KEY);
}

/**
 * Rutas /internal (consumidas por M8): exige `x-api-key` igual a INTERNAL_API_KEY.
 * Si la variable no está configurada, rechaza todo con 401 (falla cerrada).
 */
export function requireInternalApiKey(): RequestHandler {
  return (req, res, next) => {
    if (matchesSecret(req.header('x-api-key'), process.env.INTERNAL_API_KEY)) {
      next();
      return;
    }
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Se requiere una clave de servicio válida en el header x-api-key'
    });
  };
}

export function requireAuthOrServiceKey(): RequestHandler {
  const userAuth = requireAuth();
  return (req, res, next) => {
    if (isValidServiceKey(req.header('X-Secret-Key'))) {
      next();
      return;
    }
    userAuth(req, res, next);
  };
}
