import crypto from 'node:crypto';

export interface AuthenticatedUser {
  userId: number;
  role?: string;
}

/**
 * Decodifica la carga útil (payload) de un token JSON o JWT.
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    const rawPayload = parts.length >= 2 ? parts[1] : parts[0];
    if (!rawPayload) return null;
    const base64 = rawPayload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Valida la firma HMAC-SHA256 del token contra el secreto configurado de M1.
 */
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

/**
 * Extrae y valida el usuario autenticado desde el encabezado Authorization: Bearer <token>.
 *
 * Política de seguridad:
 * 1. En producción (NODE_ENV=production):
 *    - Se prohíbe cualquier token de test ("test-token-*").
 *    - Se exige verificación criptográfica HMAC-SHA256 contra M1_JWT_SECRET (o JWT_SECRET).
 *    - Si la clave secreta no está configurada en variables de entorno, FALLA CERRADO (retorna null / 401).
 *    - No se inventa ningún mecanismo OAuth2/M2M inseguro ni bypass.
 * 2. En entorno de test (NODE_ENV=test o ejecución bajo test runner):
 *    - Se permite resolver tokens de test explícitos "test-token-<id>".
 *    - Si se provee M1_JWT_SECRET con token firmado, se valida su firma criptográfica.
 */
export function extractAuthenticatedUser(authHeader?: string): AuthenticatedUser | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const isProduction = process.env.NODE_ENV === 'production';
  const isTest =
    process.env.NODE_ENV === 'test' ||
    process.argv.some((arg) => arg.includes('--test'));

  // 1. Manejo de tokens de testing directo tipo "test-token-91" o "test-token-usr-0091"
  if (token.startsWith('test-token-')) {
    // ESTRICTO: Tokens de prueba están TOTALMENTE PROHIBIDOS en producción
    if (isProduction || !isTest) {
      return null;
    }
    const rawId = token.replace('test-token-usr-', '').replace('test-token-', '');
    const numId = parseInt(rawId, 10);
    if (!Number.isNaN(numId) && Number.isInteger(numId) && numId >= 1) {
      return { userId: numId, role: 'CLIENT' };
    }
    return null;
  }

  // 2. Verificación criptográfica obligatoria en producción (Falla cerrado)
  const jwtSecret = process.env.M1_JWT_SECRET || process.env.JWT_SECRET;

  if (isProduction) {
    if (!jwtSecret) {
      // Falla cerrado: Sin clave secreta configurada no se acepta ningún token en producción
      return null;
    }
    if (!verifyJwtSignature(token, jwtSecret)) {
      return null;
    }
  } else if (jwtSecret && token.includes('.')) {
    // Si está configurado el secreto en entorno de test/dev, validar la firma
    const isValid = verifyJwtSignature(token, jwtSecret);
    if (!isValid) return null;
  } else if (!isTest) {
    // En cualquier entorno no-test, si no hay clave secreta, falla cerrado
    return null;
  }

  // 3. Extracción y validación estricta del contrato canónico de M1 (userId numérico + role)
  const payload = parseJwtPayload(token);
  if (!payload) return null;

  const rawUserId = payload.userId;
  if (typeof rawUserId !== 'number' || !Number.isInteger(rawUserId) || rawUserId < 1) {
    return null;
  }

  return {
    userId: rawUserId,
    role: typeof payload.role === 'string' ? payload.role : 'CLIENT',
  };
}
