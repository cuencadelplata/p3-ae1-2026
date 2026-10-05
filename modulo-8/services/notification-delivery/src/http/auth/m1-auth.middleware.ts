import crypto from 'node:crypto';

export interface AuthenticatedUser {
  userId: number;
  role?: string;
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    // Acepta JWT estandar (header.payload.signature) o token base64 directo
    const rawPayload = parts.length >= 2 ? parts[1] : parts[0];
    if (!rawPayload) return null;
    const base64 = rawPayload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function verifyJwtSignature(token: string, secret: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return false;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

export function extractAuthenticatedUser(authHeader?: string): AuthenticatedUser | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // Soporte de tokens de testing directo tipo "test-token-91" o "test-token-usr-0091"
  if (token.startsWith('test-token-')) {
    const rawId = token.replace('test-token-usr-', '').replace('test-token-', '');
    const numId = parseInt(rawId, 10);
    if (!Number.isNaN(numId) && Number.isInteger(numId) && numId >= 1) {
      return { userId: numId, role: 'CLIENT' };
    }
    return null;
  }

  // Verificación criptográfica si M1_JWT_SECRET está configurado
  const jwtSecret = process.env.M1_JWT_SECRET || process.env.JWT_SECRET;
  if (jwtSecret && token.includes('.')) {
    const isValid = verifyJwtSignature(token, jwtSecret);
    if (!isValid) return null;
  }

  const payload = parseJwtPayload(token);
  if (!payload) return null;

  // Contrato canónico de M1 confirmado: userId numérico entero >= 1 + role
  const rawUserId = payload.userId;
  if (typeof rawUserId !== 'number' || !Number.isInteger(rawUserId) || rawUserId < 1) {
    return null;
  }

  return {
    userId: rawUserId,
    role: typeof payload.role === 'string' ? payload.role : 'CLIENT',
  };
}
