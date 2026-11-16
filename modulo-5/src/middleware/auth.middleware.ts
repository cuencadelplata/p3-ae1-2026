import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const M1_BASE_URL = process.env.M1_AUTH_URL || 'http://localhost:3001';
const VALIDATE_ENDPOINT = `${M1_BASE_URL}/auth/validar-identidad-y-rol`;

export interface AuthenticatedUser {
  userId: string | number;
  role: string;
}

export interface AuthContext {
  userId: string;
  mode: 'jwt' | 'simulated';
}

// Augmentar el tipo Request de Express para incluir tanto authenticatedUser como auth
declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
      auth?: AuthContext;
    }
  }
}

const base64urlToBuffer = (value: string): Buffer => Buffer.from(value, 'base64url');

function unauthorized(res: Response, code: string, message: string, status = 401): void {
  if (status === 401) {
    res.setHeader('WWW-Authenticate', 'Bearer');
  }
  res.status(status).json({ code, message, timestamp: new Date().toISOString() });
}

/**
 * Verifica un JWT HS256 (RNF-10). Devuelve el `sub` si es válido o lanza Error con un motivo.
 */
export function verifyJwt(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Formato de token inválido');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  let payload: { sub?: unknown; userId?: unknown; exp?: number; nbf?: number };
  try {
    header = JSON.parse(base64urlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(base64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    throw new Error('Token ilegible');
  }

  // Solo HS256: rechaza "none" y cualquier otro algoritmo
  if (header.alg !== 'HS256') {
    throw new Error('Algoritmo no permitido');
  }

  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const received = base64urlToBuffer(signatureB64);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Firma inválida');
  }

  if (typeof payload.exp !== 'number') {
    throw new Error('El token no tiene vencimiento (exp)');
  }
  if (payload.exp <= nowSeconds) {
    throw new Error('Token vencido');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
    throw new Error('Token todavía no válido');
  }

  const subject = payload.sub ?? payload.userId;
  if (subject === undefined || subject === null || String(subject).trim() === '') {
    throw new Error('El token no identifica al usuario (sub)');
  }
  return String(subject);
}

let warnedSimulated = false;

/**
 * Middleware de autenticación para rutas de RF-5.1 (creación y consulta de viaje).
 * Soporta modo JWT estricto (por defecto) y modo simulado para tests.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const mode = (process.env.AUTH_MODE || 'jwt').toLowerCase();

  if (mode === 'simulated') {
    if (!warnedSimulated && process.env.NODE_ENV !== 'test') {
      warnedSimulated = true;
      console.warn('[M5][AUTH] AUTH_MODE=simulated: identidad SIMULADA por header x-user-id (no es seguridad real).');
    }
    const header = req.headers['x-user-id'] || req.headers['x-client-id'];
    const userId = header?.toString().trim();
    if (!userId) {
      unauthorized(res, 'UNAUTHENTICATED', 'Falta la identidad del cliente (header x-user-id en modo simulado).');
      return;
    }
    req.auth = { userId, mode: 'simulated' };
    req.authenticatedUser = { userId, role: 'CLIENTE' };
    next();
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    unauthorized(res, 'AUTH_NOT_CONFIGURED', 'La autenticación no está configurada en el servicio (JWT_SECRET).', 503);
    return;
  }

  const authorization = req.headers.authorization;
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    unauthorized(res, 'UNAUTHENTICATED', "Se requiere el header 'Authorization: Bearer <token>'.");
    return;
  }

  try {
    const userId = verifyJwt(authorization.replace(/^Bearer\s+/i, ''), secret);
    req.auth = { userId, mode: 'jwt' };
    req.authenticatedUser = { userId, role: 'CLIENTE' };
    next();
  } catch (error) {
    unauthorized(res, 'INVALID_TOKEN', (error as Error).message);
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

  // 1. Si viene header Authorization con Bearer, validar con M1 o verifyJwt
  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (process.env.JWT_SECRET && !process.env.M1_AUTH_URL && process.env.NODE_ENV !== 'test') {
      try {
        const userId = verifyJwt(authHeader.replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET);
        req.auth = { userId, mode: 'jwt' };
        req.authenticatedUser = { userId, role: 'CLIENTE' };
        return next();
      } catch {
        // Fallback a M1
      }
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

    req.authenticatedUser = { userId: result.userId, role: result.role };
    req.auth = { userId: String(result.userId), mode: 'jwt' };
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
      req.auth = { userId: testUserId.toString(), mode: 'simulated' };
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
