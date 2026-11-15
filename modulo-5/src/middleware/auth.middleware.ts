import { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Autenticación de los endpoints de RF-5.1 (RNF-10).
 *
 * Dos modos, elegidos con la variable de entorno AUTH_MODE (se lee en cada request):
 *
 *  - "jwt" (por defecto): exige `Authorization: Bearer <JWT>` firmado con HS256 usando
 *    JWT_SECRET. La identidad del cliente sale SOLO del claim `sub` del token validado.
 *    Los headers x-user-id / x-client-id se ignoran, así nadie puede hacerse pasar por otro.
 *
 *  - "simulated": SIMULACIÓN de identidad para desarrollo/tests. Toma el cliente del header
 *    x-user-id / x-client-id sin verificar nada. Debe declararse como simulación en la
 *    entrega y no usarse como seguridad real.
 *
 * Supuesto a confirmar con M1 (Identidad): algoritmo HS256 con secreto compartido y
 * claim `sub` = id del usuario. Si M1 firma con otro esquema (ej. RS256/JWKS) solo hay que
 * cambiar `verifyJwt`.
 */

export interface AuthContext {
  userId: string;
  mode: 'jwt' | 'simulated';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
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
 * Verifica un JWT HS256. Devuelve el `sub` si es válido o lanza Error con un motivo.
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
    next();
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Falla cerrada: sin secreto configurado no se acepta ningún token
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
    next();
  } catch (error) {
    unauthorized(res, 'INVALID_TOKEN', (error as Error).message);
  }
}
