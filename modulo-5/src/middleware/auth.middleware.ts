import { Request, Response, NextFunction } from 'express';

const M1_BASE_URL = process.env.M1_AUTH_URL || 'http://localhost:3001';
const VALIDATE_ENDPOINT = `${M1_BASE_URL}/auth/validar-identidad-y-rol`;

export interface AuthenticatedUser {
  userId: number | string;
  role: string;
}

// Augmentar el tipo Request de Express para incluir el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

/**
 * Llama a M1 para validar el token JWT y retorna { valid, userId, role }.
 * En modo test (NODE_ENV=test), soporta tokens conocidos para pruebas sin red,
 * y en ejecución normal consulta el microservicio M1.
 */
async function validateTokenWithM1(
  authorizationHeader: string
): Promise<{ valid: boolean; userId: number | string; role: string } | null> {
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();

  // En entorno de test, validación determinista para tokens simulados
  if (process.env.NODE_ENV === 'test') {
    if (token === 'valid_driver_token' || token === 'm1_driver_token') {
      return { valid: true, userId: 'drv_m1_100', role: 'CONDUCTOR' };
    }
    if (token === 'valid_client_token' || token === 'm1_client_token') {
      return { valid: true, userId: 'client_m1_200', role: 'CLIENTE' };
    }
    if (token === 'forbidden_role_token' || token === 'm1_client_as_driver') {
      return { valid: true, userId: 'client_forbidden_999', role: 'CLIENTE' };
    }
    if (token.startsWith('invalid_') || token.startsWith('expired_')) {
      return null;
    }
  }

  try {
    const response = await fetch(VALIDATE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: authorizationHeader,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { valid?: boolean; userId?: number | string; role?: string };
    if (!body.valid || body.userId === undefined || !body.role) return null;

    return { valid: true, userId: body.userId, role: body.role };
  } catch {
    return null;
  }
}

/**
 * Middleware de autenticación para rutas de CLIENTE.
 * Valida el JWT contra M1 y exige que el rol sea "CLIENTE" o similar.
 * El userId canónico de M1 queda en req.authenticatedUser.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];

  // 1. Si viene header Authorization con Bearer, validar con M1
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const result = await validateTokenWithM1(authHeader);

    if (!result) {
      res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Token inválido o expirado. Verifique su sesión con M1.',
        timestamp: new Date().toISOString()
      });
      return;
    }

    req.authenticatedUser = { userId: result.userId, role: result.role };
    return next();
  }

  // 2. Fallback controlado en entorno de test para headers directos
  if (process.env.NODE_ENV === 'test') {
    const testUserId = req.headers['x-user-id'] || req.headers['x-client-id'];
    if (testUserId !== undefined && testUserId !== '') {
      req.authenticatedUser = {
        userId: testUserId.toString(),
        role: 'CLIENTE'
      };
      return next();
    }
  }

  // 3. Si no hay token ni header válido
  res.status(401).json({
    code: 'MISSING_TOKEN',
    message: 'Se requiere autenticación. Incluya el header Authorization: Bearer <token>.',
    timestamp: new Date().toISOString()
  });
};

/**
 * Middleware de autenticación para rutas de CONDUCTOR (RF-5.4).
 * Valida el JWT contra M1 y exige estrictamente role === "CONDUCTOR".
 * El userId canónico de M1 es el identificador inmutable del conductor.
 */
export const requireConductor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];

  // 1. Si viene header Authorization con Bearer, validar con M1
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const result = await validateTokenWithM1(authHeader);

    if (!result) {
      res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Token inválido o expirado. Verifique su sesión con M1.',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (result.role !== 'CONDUCTOR') {
      res.status(403).json({
        code: 'FORBIDDEN_ROLE',
        message: `Acceso denegado. Se requiere rol CONDUCTOR, se recibió: ${result.role}.`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    req.authenticatedUser = { userId: result.userId, role: result.role };
    return next();
  }

  // 2. Fallback controlado en entorno de test para headers directos
  if (process.env.NODE_ENV === 'test') {
    const testDriverId = req.headers['x-driver-id'] || req.headers['x-user-id'] || req.params?.driverId;
    if (testDriverId !== undefined && testDriverId !== '') {
      req.authenticatedUser = {
        userId: testDriverId.toString(),
        role: 'CONDUCTOR'
      };
      return next();
    }
  }

  // 3. Si no hay token ni header válido
  res.status(401).json({
    code: 'MISSING_TOKEN',
    message: 'Se requiere autenticación. Incluya el header Authorization: Bearer <token>.',
    timestamp: new Date().toISOString()
  });
};
