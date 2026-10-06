import { createHash } from 'node:crypto';
import { z } from 'zod';
import { runRedisCommand } from '../config/redis.js';
import { createPolicy } from '../resilience/policies.js';
import type { AuthIdentity, AuthValidator } from '../types/auth.js';
import { UserIdSchema } from '../types/customer.js';

const MAX_CACHE_TTL_SECONDS = 5 * 60;
const DEFAULT_M1_SERVICE_URL = 'http://localhost:3000/__stubs/m1';

// M1 responde además authMethod y los datos del usuario (usuario: {...}): se ignoran,
// M2 solo necesita userId y role. Con valid: false (usuario inexistente o no ACTIVO)
// el token se trata como rechazado.
const M1ValidationResponseSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(true), userId: UserIdSchema, role: z.string().min(1) }),
  z.object({ valid: z.literal(false) })
]);

const CachedIdentitySchema = z.object({
  userId: UserIdSchema,
  role: z.string().min(1)
}).strict();

const JwtExpirationSchema = z.object({
  exp: z.number().int()
}).passthrough();

export type M1Policy = {
  readonly execute: <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: { readonly idempotent: boolean }
  ) => Promise<T>;
};

export interface AuthTokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

type M1AuthClientDependencies = {
  readonly cache: AuthTokenCache;
  readonly fetch: typeof globalThis.fetch;
  readonly nowSeconds: () => number;
  readonly policy: M1Policy;
  readonly serviceUrl: () => string;
};

export class M1HttpError extends Error {
  readonly name = 'M1HttpError';

  constructor(readonly status: number, options?: ErrorOptions) {
    super(`M1 respondió con estado ${status}`, options);
  }
}

function tokenCacheKey(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex');
  return `auth:token:${digest}`;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function cacheTtlSeconds(token: string, nowSeconds: number): number | null {
  const payloadPart = token.split('.')[1];
  if (payloadPart === undefined) return null;

  const payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
  const payload = JwtExpirationSchema.safeParse(parseJson(payloadJson));
  if (!payload.success) return null;

  const remainingSeconds = payload.data.exp - nowSeconds;
  if (remainingSeconds <= 0) return null;
  return Math.min(remainingSeconds, MAX_CACHE_TTL_SECONDS);
}

async function readCachedIdentity(
  cache: AuthTokenCache,
  key: string
): Promise<AuthIdentity | null> {
  try {
    const cached = await cache.get(key);
    if (cached === null) return null;
    const parsed = CachedIdentitySchema.safeParse(parseJson(cached));
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    if (error instanceof Error) return null;
    throw error;
  }
}

async function writeCachedIdentity(
  cache: AuthTokenCache,
  key: string,
  identity: AuthIdentity,
  ttlSeconds: number
): Promise<void> {
  try {
    await cache.set(key, JSON.stringify(identity), ttlSeconds);
  } catch (error: unknown) {
    if (error instanceof Error) return;
    throw error;
  }
}

async function parseM1Response(response: Response): Promise<AuthIdentity | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    if (error instanceof Error) throw new M1HttpError(502, { cause: error });
    throw error;
  }

  const parsed = M1ValidationResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new M1HttpError(502, { cause: parsed.error });
  }
  if (!parsed.data.valid) return null;
  return { userId: parsed.data.userId, role: parsed.data.role };
}

function validationEndpoint(serviceUrl: string): string {
  return `${serviceUrl.replace(/\/+$/, '')}/auth/validar-identidad-y-rol`;
}

export function createM1AuthClient(dependencies: M1AuthClientDependencies): AuthValidator {
  return {
    async validateToken(token: string): Promise<AuthIdentity | null> {
      const cacheKey = tokenCacheKey(token);
      const ttlSeconds = cacheTtlSeconds(token, dependencies.nowSeconds());
      if (ttlSeconds !== null) {
        const cachedIdentity = await readCachedIdentity(dependencies.cache, cacheKey);
        if (cachedIdentity !== null) return cachedIdentity;
      }

      const identity = await dependencies.policy.execute(async (signal) => {
        const response = await dependencies.fetch(validationEndpoint(dependencies.serviceUrl()), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal
        });

        if (response.status === 401) return null;
        if (!response.ok) {
          const status = response.status === 429 || response.status >= 500
            ? response.status
            : 502;
          throw new M1HttpError(status);
        }
        return parseM1Response(response);
      }, { idempotent: true });

      if (identity === null) return null;

      if (ttlSeconds !== null) {
        await writeCachedIdentity(dependencies.cache, cacheKey, identity, ttlSeconds);
      }
      return identity;
    }
  };
}

const redisAuthTokenCache: AuthTokenCache = {
  get(key) {
    return runRedisCommand((client) => client.get(key));
  },
  async set(key, value, ttlSeconds) {
    await runRedisCommand((client) => client.set(key, value, 'EX', ttlSeconds));
  }
};

export const m1AuthClient = createM1AuthClient({
  cache: redisAuthTokenCache,
  fetch: globalThis.fetch,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  policy: createPolicy('m1'),
  serviceUrl: () => process.env.M1_SERVICE_URL ?? DEFAULT_M1_SERVICE_URL
});
