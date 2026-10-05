import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  M1HttpError,
  createM1AuthClient,
  type AuthTokenCache,
  type M1Policy
} from '../../src/clients/m1-auth.client.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';

const NOW_SECONDS = 1_800_000_000;
const identity = { userId: 12, role: 'CLIENTE' } as const;

function tokenWithExpiration(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature`;
}

function immediatePolicy(): M1Policy {
  return {
    execute<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return operation(new AbortController().signal);
    }
  };
}

function memoryCache(initialValue: string | null = null): AuthTokenCache & {
  readonly get: ReturnType<typeof vi.fn>;
  readonly set: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async () => initialValue),
    set: vi.fn(async () => undefined)
  };
}

function successfulFetch() {
  return vi.fn(async (
    _input: string | URL | Request,
    _init?: RequestInit
  ): Promise<Response> => new Response(JSON.stringify({ valid: true, ...identity }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
}

describe('E7 - Cliente de autenticación M1', () => {
  it('usa la identidad validada de caché sin consultar M1', async () => {
    const cache = memoryCache(JSON.stringify(identity));
    const fetchImplementation = successfulFetch();
    const client = createM1AuthClient({
      cache,
      fetch: fetchImplementation,
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    const result = await client.validateToken(tokenWithExpiration(NOW_SECONDS + 3600));

    expect(result).toEqual(identity);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('consulta M1 con AbortSignal y guarda sha256 durante como máximo cinco minutos', async () => {
    const cache = memoryCache();
    const fetchImplementation = successfulFetch();
    const token = tokenWithExpiration(NOW_SECONDS + 3600);
    const client = createM1AuthClient({
      cache,
      fetch: fetchImplementation,
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test/'
    });

    const result = await client.validateToken(token);

    expect(result).toEqual(identity);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const fetchCall = fetchImplementation.mock.calls[0];
    expect(fetchCall).toBeDefined();
    expect(fetchCall?.[0]).toBe('http://m1.test/auth/validar-identidad-y-rol');
    expect(fetchCall?.[1]?.headers).toEqual({ Authorization: `Bearer ${token}` });
    expect(fetchCall?.[1]?.signal).toBeInstanceOf(AbortSignal);

    const expectedKey = `auth:token:${createHash('sha256').update(token).digest('hex')}`;
    expect(cache.get).toHaveBeenCalledWith(expectedKey);
    expect(cache.set).toHaveBeenCalledWith(expectedKey, JSON.stringify(identity), 300);
    expect(expectedKey).not.toContain(token);
  });

  it('limita el TTL al tiempo restante del exp sin usar el payload como autoridad', async () => {
    const cache = memoryCache();
    const fetchImplementation = successfulFetch();
    const token = tokenWithExpiration(NOW_SECONDS + 90);
    const client = createM1AuthClient({
      cache,
      fetch: fetchImplementation,
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    const result = await client.validateToken(token);

    expect(result).toEqual(identity);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), JSON.stringify(identity), 90);
  });

  it('no acepta un hit de caché después de exp y vuelve a consultar a M1', async () => {
    const cache = memoryCache(JSON.stringify(identity));
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 401 }));
    const client = createM1AuthClient({
      cache,
      fetch: fetchImplementation,
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    const result = await client.validateToken(tokenWithExpiration(NOW_SECONDS - 1));

    expect(result).toBeNull();
    expect(cache.get).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('continúa validando contra M1 si Redis falla al leer y escribir', async () => {
    const cache: AuthTokenCache = {
      get: vi.fn(async () => { throw new Error('redis down'); }),
      set: vi.fn(async () => { throw new Error('redis down'); })
    };
    const client = createM1AuthClient({
      cache,
      fetch: successfulFetch(),
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    await expect(client.validateToken(tokenWithExpiration(NOW_SECONDS + 3600)))
      .resolves.toEqual(identity);
  });

  it('trata 401 como token inválido y no lo guarda', async () => {
    const cache = memoryCache();
    const client = createM1AuthClient({
      cache,
      fetch: vi.fn(async () => new Response(null, { status: 401 })),
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    await expect(client.validateToken(tokenWithExpiration(NOW_SECONDS + 3600)))
      .resolves.toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('rechaza una respuesta 200 malformada como fallo del contrato externo', async () => {
    const client = createM1AuthClient({
      cache: memoryCache(),
      fetch: vi.fn(async () => new Response(JSON.stringify({ valid: true, userId: '12' }), {
        status: 200
      })),
      nowSeconds: () => NOW_SECONDS,
      policy: immediatePolicy(),
      serviceUrl: () => 'http://m1.test'
    });

    await expect(client.validateToken(tokenWithExpiration(NOW_SECONDS + 3600)))
      .rejects.toMatchObject({ name: 'M1HttpError', status: 502 });
    await expect(Promise.reject(new M1HttpError(503))).rejects.toBeInstanceOf(M1HttpError);
  });

  it('propaga una caída de M1 como ServiceUnavailableError, nunca como token inválido', async () => {
    const unavailablePolicy: M1Policy = {
      execute: async () => {
        throw new ServiceUnavailableError('m1 no disponible');
      }
    };
    const client = createM1AuthClient({
      cache: memoryCache(),
      fetch: successfulFetch(),
      nowSeconds: () => NOW_SECONDS,
      policy: unavailablePolicy,
      serviceUrl: () => 'http://m1.test'
    });

    await expect(client.validateToken(tokenWithExpiration(NOW_SECONDS + 3600)))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
