import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import type { Receipt } from '../models/receipt';
import { createLogger } from '../observability/logger';

const log = createLogger('auth-m1');

export interface AuthenticatedUser {
  userId: string;
  role: 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | string;
}

declare global {
  namespace Express {
    interface Request {
      usuarioAutenticado?: AuthenticatedUser;
    }
  }
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Valida un token JWT con algoritmo HS256 emitido por el Modulo 1 (Identidad y Acceso).
 */
export function verifyM1Token(token: string, secret: string = env.jwtSecret): AuthenticatedUser {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw AppError.unauthorized('INVALID_TOKEN_FORMAT', 'El formato del token JWT es invalido');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verificacion de firma HMAC-SHA256
  const data = `${headerB64}.${payloadB64}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const sigBuffer = Buffer.from(signatureB64);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw AppError.unauthorized('INVALID_TOKEN_SIGNATURE', 'La firma del token de autenticacion es invalida');
  }

  let payload: { userId?: unknown; role?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw AppError.unauthorized('INVALID_TOKEN_PAYLOAD', 'El cuerpo del token no es un JSON valido');
  }

  if (payload.exp !== undefined && typeof payload.exp === 'number') {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds > payload.exp) {
      throw AppError.unauthorized('TOKEN_EXPIRED', 'El token de autenticacion ha expirado');
    }
  }

  if (!payload.userId || !payload.role) {
    throw AppError.unauthorized('INVALID_TOKEN_CLAIMS', 'El token no contiene userId o role');
  }

  return {
    userId: String(payload.userId),
    role: String(payload.role),
  };
}

/**
 * Middleware para validar la autenticacion provista por M1.
 * Si AUTH_REQUIRED es false y no se envia cabecera, permite continuar para no romper
 * tests de integracion existentes. Si se envia Authorization, se valida estrictamente.
 */
export const authenticateM1: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    if (env.authRequired) {
      throw AppError.unauthorized(
        'AUTH_REQUIRED',
        'Se requiere cabecera Authorization: Bearer <token> para acceder al recurso',
      );
    }
    return next();
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw AppError.unauthorized(
      'INVALID_AUTH_HEADER',
      'El encabezado Authorization debe tener el formato Bearer <token>',
    );
  }

  try {
    const user = verifyM1Token(parts[1]);
    req.usuarioAutenticado = user;
    log('info', 'usuario autenticado por M1', { userId: user.userId, role: user.role });
    next();
  } catch (error) {
    next(error);
  }
};

/** Normaliza un identificador para comparar ID numerico y alfanumerico (ej. cli-101 vs 101). */
function idsMatch(entityId: string, userId: string): boolean {
  if (entityId === userId) return true;
  const strippedEntity = entityId.replace(/^[a-zA-Z_-]+/, '');
  const strippedUser = userId.replace(/^[a-zA-Z_-]+/, '');
  return Boolean(strippedEntity && strippedUser && strippedEntity === strippedUser);
}

/**
 * Valida que el usuario autenticado tenga permisos sobre el comprobante:
 * - Operador: permiso total.
 * - Cliente: debe coincidir con el cliente del comprobante.
 * - Conductor: debe coincidir con el conductor del comprobante.
 */
export function authorizeReceiptPermission(receipt: Receipt, user?: AuthenticatedUser): void {
  if (!user) {
    // Si no hay usuario autenticado (modo sin auth obligatoria en tests heredados), permitir acceso
    return;
  }

  if (user.role === 'OPERADOR') {
    return;
  }

  if (user.role === 'CLIENTE') {
    if (idsMatch(receipt.customer.id, user.userId)) {
      return;
    }
    log('warn', 'acceso denegado a cliente sobre comprobante ajeno', {
      userId: user.userId,
      customerReceiptId: receipt.customer.id,
      tripId: receipt.tripId,
    });
    throw AppError.forbidden(
      'INSUFFICIENT_PERMISSIONS',
      'El usuario no tiene permisos sobre este comprobante (pertenece a otro cliente)',
    );
  }

  if (user.role === 'CONDUCTOR') {
    if (idsMatch(receipt.driver.id, user.userId)) {
      return;
    }
    log('warn', 'acceso denegado a conductor sobre comprobante ajeno', {
      userId: user.userId,
      driverReceiptId: receipt.driver.id,
      tripId: receipt.tripId,
    });
    throw AppError.forbidden(
      'INSUFFICIENT_PERMISSIONS',
      'El conductor autenticado no realizo el viaje de este comprobante',
    );
  }

  throw AppError.forbidden(
    'INSUFFICIENT_PERMISSIONS',
    `El rol ${user.role} no tiene permisos para acceder al comprobante`,
  );
}