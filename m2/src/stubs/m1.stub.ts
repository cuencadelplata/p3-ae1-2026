import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const DEFAULT_STUB_SECRET = 'm1-stub-development-secret';
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const;

const TestTokenRequestSchema = z.object({
  userId: z.number().int().positive(),
  role: z.string().trim().min(1).max(64)
}).strict();

const JwtHeaderSchema = z.object({
  alg: z.literal('HS256'),
  typ: z.literal('JWT')
}).strict();

const JwtPayloadSchema = z.object({
  userId: z.number().int().positive(),
  role: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int()
}).strict();

type JwtPayload = z.infer<typeof JwtPayloadSchema>;

function signingSecret(): string {
  return process.env.M1_JWT_SECRET ?? DEFAULT_STUB_SECRET;
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(unsignedToken: string): Buffer {
  return createHmac('sha256', signingSecret()).update(unsignedToken).digest();
}

function issueToken(userId: number, role: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload = { userId, role, iat, exp: iat + TOKEN_LIFETIME_SECONDS } as const;
  const unsignedToken = `${encodeJson(JWT_HEADER)}.${encodeJson(payload)}`;
  return `${unsignedToken}.${sign(unsignedToken).toString('base64url')}`;
}

function parseJsonPart(part: string): unknown | null {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch (error: unknown) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    return null;
  }

  const unsignedToken = `${headerPart}.${payloadPart}`;
  const expectedSignature = sign(unsignedToken);
  const providedSignature = Buffer.from(signaturePart, 'base64url');
  if (
    providedSignature.length !== expectedSignature.length
    || !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  const header = JwtHeaderSchema.safeParse(parseJsonPart(headerPart));
  const payload = JwtPayloadSchema.safeParse(parseJsonPart(payloadPart));
  if (!header.success || !payload.success || payload.data.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload.data;
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export const m1StubRouter = Router();

m1StubRouter.post('/auth/token-de-prueba', (req, res) => {
  const parsed = TestTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'ValidationError',
      message: 'userId y role son obligatorios y deben ser válidos'
    });
    return;
  }

  res.json({
    token: issueToken(parsed.data.userId, parsed.data.role),
    expiresIn: TOKEN_LIFETIME_SECONDS
  });
});

m1StubRouter.get('/auth/validar-identidad-y-rol', (req, res) => {
  const token = bearerToken(req.header('Authorization'));
  const payload = token === null ? null : verifyToken(token);
  if (payload === null) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Token ausente, inválido o vencido'
    });
    return;
  }

  res.json({
    valid: true,
    userId: payload.userId,
    role: payload.role
  });
});

// Datos personales de ejemplo (en M1 real salen de su base de usuarios)
const DEMO_USERS: Record<number, { nombre: string; apellido: string; dni: string; telefono: string }> = {
  12: { nombre: 'Ana', apellido: 'Pérez', dni: '30111222', telefono: '+54 9 362 4111222' },
  13: { nombre: 'Bruno', apellido: 'Gómez', dni: '31222333', telefono: '+54 9 362 4222333' },
  14: { nombre: 'Carla', apellido: 'Díaz', dni: '32333444', telefono: '+54 9 362 4333444' }
};

// Mismo contrato que M1 real (GET /auth/me): solo los datos del dueño del token
m1StubRouter.get('/auth/me', (req, res) => {
  const token = bearerToken(req.header('Authorization'));
  const payload = token === null ? null : verifyToken(token);
  if (payload === null) {
    res.status(401).json({ error: 'Unauthorized', message: 'Token ausente, inválido o vencido' });
    return;
  }

  const demo = DEMO_USERS[payload.userId] ?? {
    nombre: 'Cliente',
    apellido: String(payload.userId),
    dni: String(40_000_000 + payload.userId),
    telefono: `+54 9 362 4${String(payload.userId).padStart(6, '0')}`
  };
  res.json({
    userId: payload.userId,
    ...demo,
    email: `cliente${payload.userId}@example.com`,
    rol: payload.role,
    estado: 'ACTIVO',
    creadoEn: '2026-09-01T12:00:00.000Z'
  });
});

m1StubRouter.get('/health', (_req, res) => {
  res.json({ status: 'UP', service: 'm1-stub' });
});
