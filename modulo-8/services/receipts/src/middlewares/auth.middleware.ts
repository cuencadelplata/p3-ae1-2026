import type { NextFunction, Request, RequestHandler, Response as ExpressResponse } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import type { Receipt } from '../models/receipt';
import { createLogger } from '../observability/logger';

const log = createLogger('auth-m1');
const M1_ROLES = ['CLIENTE', 'CONDUCTOR', 'OPERADOR'] as const;

export type M1Role = (typeof M1_ROLES)[number];

export interface AuthenticatedUser {
  userId: number;
  role: M1Role;
}

export type IdentityValidator = (authorization: string) => Promise<AuthenticatedUser>;

declare global {
  namespace Express {
    interface Request {
      usuarioAutenticado?: AuthenticatedUser;
    }
  }
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { userId?: unknown; role?: unknown };
  return (
    typeof candidate.userId === 'number' &&
    Number.isInteger(candidate.userId) &&
    candidate.userId > 0 &&
    typeof candidate.role === 'string' &&
    (M1_ROLES as readonly string[]).includes(candidate.role)
  );
}

/**
 * Valida el Bearer del usuario contra M1. M8 no decodifica JWT ni conserva
 * secretos de M1: reenvía el token recibido al endpoint confirmado por M1.
 */
export function createM1IdentityValidator(
  endpoint: string = env.m1IdentityUrl,
  timeoutMs: number = env.m1TimeoutMs,
  fetchImpl: typeof fetch = fetch,
): IdentityValidator {
  return async (authorization: string): Promise<AuthenticatedUser> => {
    if (!endpoint) {
      throw AppError.unavailable(
        'M1_IDENTITY_NOT_CONFIGURED',
        'La validacion de identidad M1 no esta configurada',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: globalThis.Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { Authorization: authorization },
        signal: controller.signal,
      });
    } catch {
      throw AppError.unavailable(
        'M1_IDENTITY_UNAVAILABLE',
        'El servicio de identidad M1 no esta disponible',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw AppError.unauthorized('INVALID_AUTH_TOKEN', 'El token de autenticacion no es valido');
    }
    if (!response.ok) {
      throw AppError.unavailable(
        'M1_IDENTITY_UNAVAILABLE',
        'El servicio de identidad M1 no esta disponible',
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw AppError.unavailable(
        'M1_IDENTITY_INVALID_RESPONSE',
        'El servicio de identidad M1 devolvio una respuesta invalida',
      );
    }

    if (!isAuthenticatedUser(body)) {
      throw AppError.unavailable(
        'M1_IDENTITY_INVALID_RESPONSE',
        'El servicio de identidad M1 devolvio una respuesta invalida',
      );
    }

    return body;
  };
}

/** Crea el middleware de autenticación para los endpoints de RF8.4. */
export function createAuthenticateM1(validator: IdentityValidator = createM1IdentityValidator()): RequestHandler {
  return async (req: Request, _res: ExpressResponse, next: NextFunction) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      next(
        AppError.unauthorized(
          'AUTH_REQUIRED',
          'Se requiere cabecera Authorization: Bearer <token> para acceder al recurso',
        ),
      );
      return;
    }
    if (!/^Bearer\s+[^\s]+$/.test(authorization)) {
      next(
        AppError.unauthorized(
          'INVALID_AUTH_HEADER',
          'El encabezado Authorization debe tener el formato Bearer <token>',
        ),
      );
      return;
    }

    try {
      req.usuarioAutenticado = await validator(authorization);
      log('info', 'usuario autenticado por M1', {
        userId: req.usuarioAutenticado.userId,
        role: req.usuarioAutenticado.role,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Autoriza según los identificadores canónicos persistidos al emitir el
 * comprobante. No se deriva la identidad M1 desde customer.id ni driver.id.
 */
export function authorizeReceiptPermission(receipt: Receipt, user?: AuthenticatedUser): void {
  if (!user) {
    throw AppError.unauthorized('AUTH_REQUIRED', 'Se requiere autenticacion para acceder al comprobante');
  }

  if (user.role === 'OPERADOR') {
    return;
  }

  if (user.role === 'CLIENTE' && receipt.customerUserId === user.userId) {
    return;
  }

  if (user.role === 'CONDUCTOR' && receipt.driverUserId === user.userId) {
    return;
  }

  log('warn', 'acceso denegado sobre comprobante', {
    userId: user.userId,
    role: user.role,
    tripId: receipt.tripId,
  });
  throw AppError.forbidden(
    'INSUFFICIENT_PERMISSIONS',
    'El usuario autenticado no tiene permisos sobre este comprobante',
  );
}
