import { Request, Response, NextFunction } from 'express';

const M1_BASE_URL = process.env.M1_AUTH_URL || 'http://localhost:3001';
const VALIDATE_ENDPOINT = `${M1_BASE_URL}/auth/validar-identidad-y-rol`;

export interface AuthenticatedUser {
  userId: string;
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
 * En modo test (NODE_ENV=test), se resuelve desde los headers de la request
 * para no depender del servicio externo.
 */
async function validateTokenWithM1(
  authorizationHeader: string
): Promise<{ valid: boolean; userId: string; role: string } | null> {
  // En entorno de test, simulamos la validación directamente
  if (process.env.NODE_ENV === 'test') {
    return null; // Deja que el middleware de test-fallback se encargue
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

    return { valid: true, userId: String(body.userId), role: body.role };
  } catch {
    return null;
  }
}

/**
 * Middleware de autenticación para rutas de CLIENTE.
 * Valida el JWT contra M1 y exige que el rol sea "CLIENTE" o cualquiera
 * (en M5 el cliente es quien crea/cancela la solicitud).
 * El userId canónico de M1 queda en req.authenticatedUser.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];

  // Fallback en tests: acepta x-user-id como bypass
  if (process.env.NODE_ENV === 'test') {
    const testUserId = req.headers['x-user-id'] || req.headers['x-client-id'];
    req.authenticatedUser = {
      userId: testUserId ? testUserId.toString() : 'anonymous',
      role: 'CLIENTE'
    };
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'MISSING_TOKEN',
      message: 'Se requiere autenticación. Incluya el header Authorization: Bearer <token>.',
      timestamp: new Date().toISOString()
    });
    return;
  }

  const result = await validateTokenWithM1(authHeader);

  if (!result) {
    res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Token inválido o expirado. Verifique su sesión con M1.',
      timestamp: new Date().toISOString()
    });
    return;
  }

  req.authenticatedUser = { userId: String(result.userId), role: result.role };
  next();
};

/**
 * Middleware de autenticación para rutas de CONDUCTOR.
 * Valida el JWT contra M1 y exige que role === "CONDUCTOR".
 * El userId canónico de M1 es el identificador del conductor.
 */
export const requireConductor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];

  // Fallback en tests: acepta x-driver-id o x-user-id como bypass
  if (process.env.NODE_ENV === 'test') {
    const testDriverId = req.headers['x-driver-id'] || req.headers['x-user-id'];
    req.authenticatedUser = {
      userId: testDriverId ? testDriverId.toString() : 'anonymous',
      role: 'CONDUCTOR'
    };
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'MISSING_TOKEN',
      message: 'Se requiere autenticación. Incluya el header Authorization: Bearer <token>.',
      timestamp: new Date().toISOString()
    });
    return;
  }

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

  req.authenticatedUser = { userId: String(result.userId), role: result.role };
  next();
};
