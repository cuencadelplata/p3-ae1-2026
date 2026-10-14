import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportError } from '../errors/support-error.js';
import { createM1IdentityClient } from './m1-identity.js';

const BASE_URL = 'http://m1.test:3001';
const AUTHORIZATION = 'Bearer token-de-prueba';

function respuesta(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clienteCon(fetchImpl: typeof fetch, timeoutMs = 2000) {
  return createM1IdentityClient({ baseUrl: BASE_URL, timeoutMs, fetchImpl });
}

// Cuerpo real de M1 para un token válido (auth.controller.ts, validateToken).
function identidad(cambios: Record<string, unknown> = {}) {
  return {
    valid: true,
    userId: 7,
    role: 'CLIENTE',
    authMethod: 'password',
    usuario: { id: 7, rol: 'CLIENTE', email: 'ana@example.com', nombre: 'Ana', apellido: 'Paz', estado: 'ACTIVO' },
    ...cambios,
  };
}

function fallo(promesa: Promise<unknown>) {
  return promesa.then(
    () => {
      throw new Error('se esperaba un rechazo');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createM1IdentityClient: verificar', () => {
  it('reenvía la cabecera Authorization a GET /auth/validar-identidad-y-rol', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuesta(200, identidad()));

    await clienteCon(fetchImpl).verificar(AUTHORIZATION);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/auth/validar-identidad-y-rol`);
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Authorization: AUTHORIZATION });
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 con valid: true: devuelve sólo userId y role', async () => {
    const cliente = clienteCon(async () => respuesta(200, identidad()));

    expect(await cliente.verificar(AUTHORIZATION)).toEqual({ userId: 7, role: 'CLIENTE' });
  });

  it.each(['CLIENTE', 'CONDUCTOR', 'OPERADOR'])('acepta el rol %s', async (role) => {
    const cliente = clienteCon(async () => respuesta(200, identidad({ role })));

    expect((await cliente.verificar(AUTHORIZATION)).role).toBe(role);
  });

  it('200 con valid: false (usuario bloqueado o inexistente): SUPPORT_INVALID_TOKEN', async () => {
    const cliente = clienteCon(async () => respuesta(200, identidad({ valid: false })));

    const error = await fallo(cliente.verificar(AUTHORIZATION));

    expect(error).toBeInstanceOf(SupportError);
    expect(error).toMatchObject({ status: 401, code: 'SUPPORT_INVALID_TOKEN' });
  });

  it.each([
    ['401', 401, { valid: false, error: 'Token inválido', code: 'invalid_token' }],
    ['401 por credencial revocada', 401, { valid: false, error: 'Credencial revocada' }],
    ['403', 403, { error: 'Acceso denegado' }],
  ])('%s de M1: SUPPORT_INVALID_TOKEN', async (_caso, status, body) => {
    const error = await fallo(clienteCon(async () => respuesta(status, body)).verificar(AUTHORIZATION));

    expect(error).toMatchObject({ status: 401, code: 'SUPPORT_INVALID_TOKEN' });
    expect((error as SupportError).retryAfterSeconds).toBeUndefined();
  });

  it.each([
    ['500 de M1', async () => respuesta(500, { error: 'Error interno del servidor' })],
    ['404 de M1 (URL mal configurada)', async () => respuesta(404, { error: 'no existe' })],
    ['200 sin cuerpo JSON', async () => new Response('<html></html>', { status: 200 })],
    ['200 sin el campo valid', async () => respuesta(200, { userId: 7, role: 'CLIENTE' })],
    ['200 con valid que no es booleano', async () => respuesta(200, identidad({ valid: 'true' }))],
    ['200 válido sin userId', async () => respuesta(200, identidad({ userId: undefined }))],
    ['200 válido con userId no entero', async () => respuesta(200, identidad({ userId: '7' }))],
    ['200 válido con userId menor a 1', async () => respuesta(200, identidad({ userId: 0 }))],
    ['200 válido con un rol desconocido', async () => respuesta(200, identidad({ role: 'ADMIN' }))],
    [
      'error de red',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('%s: SUPPORT_IDENTITY_UNAVAILABLE', async (_caso, fetchImpl) => {
    const error = await fallo(clienteCon(fetchImpl as typeof fetch).verificar(AUTHORIZATION));

    expect(error).toBeInstanceOf(SupportError);
    expect(error).toMatchObject({ status: 503, code: 'SUPPORT_IDENTITY_UNAVAILABLE', retryAfterSeconds: 5 });
  });

  it('M1 no responde dentro del timeout: SUPPORT_IDENTITY_UNAVAILABLE', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });

    const error = await fallo(clienteCon(fetchImpl, 20).verificar(AUTHORIZATION));

    expect(error).toMatchObject({ status: 503, code: 'SUPPORT_IDENTITY_UNAVAILABLE' });
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { motivo: 'sin respuesta en 20 ms' });
  });

  it('no registra el token ni lo incluye en el error', async () => {
    const error = (await fallo(
      clienteCon(async () => respuesta(500)).verificar('Bearer secreto-123'),
    )) as SupportError;

    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secreto-123');
    expect(error.message).not.toContain('secreto-123');
  });
});

describe('createM1IdentityClient: isReachable', () => {
  it('true si GET /health de M1 responde 2xx', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuesta(200, { status: 'OK' }));

    expect(await clienteCon(fetchImpl).isReachable()).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/health`);
  });

  it('false si responde un error o no se puede conectar, sin lanzar', async () => {
    expect(await clienteCon(async () => respuesta(503)).isReachable()).toBe(false);
    expect(
      await clienteCon(async () => {
        throw new TypeError('fetch failed');
      }).isReachable(),
    ).toBe(false);
  });
});

describe('createM1IdentityClient: timeout al leer el cuerpo', () => {
  // M1 manda las cabeceras y se cuelga a mitad del cuerpo: la señal del
  // timeout corta la lectura, como hace fetch.
  const cuerpoColgado: typeof fetch = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"valid":'));
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  it('se informa como timeout, no como formato inesperado', async () => {
    const error = await fallo(clienteCon(cuerpoColgado, 20).verificar(AUTHORIZATION));

    expect(error).toMatchObject({ status: 503, code: 'SUPPORT_IDENTITY_UNAVAILABLE', retryAfterSeconds: 5 });
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { motivo: 'sin respuesta en 20 ms' });
  });

  it('un cuerpo que no es JSON sigue siendo formato inesperado', async () => {
    await fallo(clienteCon(async () => new Response('no es json', { status: 200 })).verificar(AUTHORIZATION));

    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { motivo: 'respuesta con formato inesperado' });
  });
});
