import crypto from 'node:crypto';

export const CANONICAL_M1_ROLES = ['CLIENTE', 'CONDUCTOR', 'OPERADOR'] as const;
export type M1Role = (typeof CANONICAL_M1_ROLES)[number];

export interface AuthenticatedUser {
  userId: number;
  role?: M1Role;
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

    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (parsedHeader.alg !== 'HS256' || (parsedHeader.typ !== undefined && parsedHeader.typ !== 'JWT')) {
      return false;
    }

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
 * Política de seguridad e integración con M1:
 * 1. Contrato Canónico de M1:
 *    - `userId`: número entero positivo >= 1 (obligatorio).
 *    - `role`: opcional, pero si está presente debe pertenecer a los roles canónicos:
 *      'CLIENTE', 'CONDUCTOR', 'OPERADOR'. Nunca se inventa un rol por defecto. Si el rol
 *      es inválido, se rechaza el token.
 *    - `exp`: si está presente en el payload, debe ser un timestamp Unix numérico en segundos
 *      y no estar vencido. Si expiró, se rechaza el token. Si M1_JWT_REQUIRE_EXP=true,
 *      la presencia de exp es obligatoria.
 * 2. Mecanismo Criptográfico (Integración Pendiente con M1):
 *    - El contrato funcional de claims fue confirmado con M1, pero el esquema de verificación
 *      criptográfica definitiva (distribución de secreto simétrico vs clave asimétrica/JWKS)
 *      sigue pendiente de confirmación formal por el equipo de M1.
 *    - Política Fail-Closed: en producción (NODE_ENV=production), si no se configuró M1_JWT_SECRET,
 *      no se permite ningún bypass ni mecanismo ad-hoc: falla cerrado retornando null (401).
 *    - Se rechaza estrictamente cualquier token vencido o con firma no coincidente.
 * 3. Entorno de Test:
 *    - Tokens de formato "test-token-*" están ESTRICTAMENTE PROHIBIDOS en producción.
 *    - En tests (NODE_ENV=test), se permite resolver "test-token-<id>" o "test-token-<rol>-<id>".
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

  // 1. Manejo de tokens de testing directo tipo "test-token-91" o "test-token-cliente-91"
  if (token.startsWith('test-token-')) {
    // ESTRICTO: Tokens de prueba están TOTALMENTE PROHIBIDOS en producción
    if (isProduction || !isTest) {
      return null;
    }

    let clean = token.replace('test-token-', '');
    let assignedRole: M1Role | undefined = undefined;

    for (const r of CANONICAL_M1_ROLES) {
      const prefix = `${r.toLowerCase()}-`;
      if (clean.startsWith(prefix)) {
        assignedRole = r;
        clean = clean.slice(prefix.length);
        break;
      }
    }

    clean = clean.replace('usr-', '');
    const numId = parseInt(clean, 10);
    if (!Number.isNaN(numId) && Number.isInteger(numId) && numId >= 1) {
      return {
        userId: numId,
        ...(assignedRole ? { role: assignedRole } : {}),
      };
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

  // 3. Extracción y validación estricta del contrato canónico de M1
  const payload = parseJwtPayload(token);
  if (!payload) return null;

  // 3.1. Validación de userId (obligatorio, numérico entero >= 1)
  const rawUserId = payload.userId;
  if (typeof rawUserId !== 'number' || !Number.isInteger(rawUserId) || rawUserId < 1) {
    return null;
  }

  // 3.2. Validación de expiración (exp)
  const requireExp = process.env.M1_JWT_REQUIRE_EXP === 'true';
  const rawExp = payload.exp;

  if (requireExp && (rawExp === undefined || typeof rawExp !== 'number')) {
    return null;
  }

  if (rawExp !== undefined) {
    if (typeof rawExp !== 'number' || Number.isNaN(rawExp)) {
      return null;
    }
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (rawExp <= nowInSeconds) {
      return null; // Token expirado
    }
  }

  // 3.3. Validación de rol canónico M1 (CLIENTE, CONDUCTOR, OPERADOR)
  // No inventar rol si falta (sin fallback). Si está presente, debe ser uno de los roles canónicos.
  const rawRole = payload.role;
  let validatedRole: M1Role | undefined = undefined;

  if (rawRole !== undefined) {
    if (typeof rawRole !== 'string' || !CANONICAL_M1_ROLES.includes(rawRole as M1Role)) {
      return null; // Rol inválido o no reconocido por M1
    }
    validatedRole = rawRole as M1Role;
  }

  return {
    userId: rawUserId,
    ...(validatedRole ? { role: validatedRole } : {}),
  };
}
