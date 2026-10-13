import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadM1IdentityConfig } from './config/env.js';
import { checkSupportReadiness } from './http/readiness.js';
import type { IdentityVerifier } from './integrations/m1-identity.js';
import { InMemoryTicketRepository } from './models/ticket.model.js';
import { buildSupportFromEnv, createSupportRuntime } from './support-runtime.js';

const DATABASE_URL = 'postgres://m8_support:secreto@127.0.0.1:1/m8';
const CONFIG = { port: 0, rabbitUrl: 'amqp://test', legacyEvents: false };

function database(available: boolean, migrationsApplied: boolean) {
  return { isAvailable: async () => available, migrationsApplied };
}

function verificador(alcanzable: boolean): IdentityVerifier {
  return { verificar: async () => ({ userId: 5, role: 'CLIENTE' }), isReachable: async () => alcanzable };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadM1IdentityConfig', () => {
  it('sin SUPPORT_M1_IDENTITY_URL, o vacía, la autenticación queda desactivada', () => {
    expect(loadM1IdentityConfig({})).toBeUndefined();
    expect(loadM1IdentityConfig({ SUPPORT_M1_IDENTITY_URL: '  ' })).toBeUndefined();
  });

  it('M1_IDENTITY_URL (la variable de Receipts) no activa la autenticación de Support', () => {
    expect(
      loadM1IdentityConfig({ M1_IDENTITY_URL: 'http://m1-identity-sandbox:4011/auth/validar-identidad-y-rol' }),
    ).toBeUndefined();
  });

  it('usa 2000 ms de timeout por defecto y quita la barra final de la URL', () => {
    expect(loadM1IdentityConfig({ SUPPORT_M1_IDENTITY_URL: 'http://m1:3001/' })).toEqual({
      baseUrl: 'http://m1:3001',
      timeoutMs: 2000,
    });
  });

  it('toma el timeout de M1_TIMEOUT_MS', () => {
    expect(loadM1IdentityConfig({ SUPPORT_M1_IDENTITY_URL: 'http://m1:3001', M1_TIMEOUT_MS: '900' })).toEqual({
      baseUrl: 'http://m1:3001',
      timeoutMs: 900,
    });
  });

  it.each(['0', '-1', '2.5', 'pronto'])('rechaza M1_TIMEOUT_MS="%s"', (valor) => {
    expect(() => loadM1IdentityConfig({ SUPPORT_M1_IDENTITY_URL: 'http://m1:3001', M1_TIMEOUT_MS: valor })).toThrow(
      /M1_TIMEOUT_MS/,
    );
  });

  it('sin SUPPORT_M1_IDENTITY_URL no valida M1_TIMEOUT_MS', () => {
    expect(loadM1IdentityConfig({ M1_TIMEOUT_MS: 'pronto' })).toBeUndefined();
  });
});

describe('checkSupportReadiness con el servicio de identidad de M1', () => {
  it('ok: M1 responde', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), identity: async () => true });

    expect(readiness.status).toBe('ok');
    expect(readiness.checks.identity).toEqual({ status: 'available', critical: false });
  });

  it('degraded: la base está bien pero M1 no responde', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), identity: async () => false });

    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.identity).toEqual({ status: 'unavailable', critical: false });
  });

  it('unavailable: la base caída pesa más que M1', async () => {
    const readiness = await checkSupportReadiness({ database: database(false, true), identity: async () => true });

    expect(readiness.status).toBe('unavailable');
  });

  it('sin autenticación habilitada no informa el check', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true) });

    expect(readiness.checks.identity).toBeUndefined();
  });
});

describe('createSupportRuntime con verificador de identidad', () => {
  function runtimeCon(identityVerifier?: IdentityVerifier) {
    return createSupportRuntime(
      CONFIG,
      new InMemoryTicketRepository(),
      database(true, true),
      true,
      undefined,
      identityVerifier,
    );
  }

  it('M1 caído deja a Support degraded, nunca unavailable: /health/ready responde 200 sin Bearer', async () => {
    const res = await request(runtimeCon(verificador(false)).app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.identity).toEqual({ status: 'unavailable', critical: false });
  });

  it('exige Bearer en /tickets y registra al autor de M1', async () => {
    const { app } = runtimeCon(verificador(true));

    const sinToken = await request(app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' });
    const conToken = await request(app)
      .post('/tickets')
      .set('Authorization', 'Bearer token')
      .send({ tripId: 'trip-1', motivo: 'Demora' });
    const historial = await request(app).get(`/tickets/${conToken.body.id}/historial`).set('Authorization', 'Bearer token');

    expect(sinToken.status).toBe(401);
    expect(conToken.status).toBe(201);
    expect(historial.body[0].cambiadoPor).toBe('m1:5');
  });

  it('sin verificador no exige Bearer ni informa el check de identidad', async () => {
    const runtime = runtimeCon();

    expect((await request(runtime.app).get('/tickets')).status).toBe(200);
    expect((await runtime.readiness()).checks.identity).toBeUndefined();
  });
});

describe('buildSupportFromEnv y SUPPORT_M1_IDENTITY_URL', () => {
  const ENV = { SUPPORT_DATABASE_URL: DATABASE_URL, SUPPORT_LEGACY_EVENTS: 'off' };

  it('sin la variable arranca sin autenticación y lo avisa en el log', async () => {
    const support = buildSupportFromEnv(ENV);

    expect(support.identityVerifier).toBeUndefined();
    expect((await support.readiness()).checks.identity).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SUPPORT_M1_IDENTITY_URL'));
    await support.pool.end();
  });

  it('con la variable de Receipts definida, Support sigue sin exigir autenticación', async () => {
    const support = buildSupportFromEnv({
      ...ENV,
      M1_IDENTITY_URL: 'http://m1-identity-sandbox:4011/auth/validar-identidad-y-rol',
    });

    expect(support.identityVerifier).toBeUndefined();
    await support.pool.end();
  });

  it('con la variable valida el token contra esa URL y consulta su /health', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/health')
        ? new Response('{"status":"OK"}', { status: 200 })
        : new Response('{"valid":true,"userId":3,"role":"OPERADOR"}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const support = buildSupportFromEnv({ ...ENV, SUPPORT_M1_IDENTITY_URL: 'http://m1.test:3001/' });
    const usuario = await support.identityVerifier?.verificar('Bearer abc');
    const readiness = await support.readiness();

    expect(usuario).toEqual({ userId: 3, role: 'OPERADOR' });
    expect(readiness.checks.identity).toEqual({ status: 'available', critical: false });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://m1.test:3001/auth/validar-identidad-y-rol',
      'http://m1.test:3001/health',
    ]);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('SUPPORT_M1_IDENTITY_URL'));
    await support.pool.end();
  });

  it('rechaza un M1_TIMEOUT_MS inválido antes de arrancar', () => {
    expect(() => buildSupportFromEnv({ ...ENV, SUPPORT_M1_IDENTITY_URL: 'http://m1.test:3001', M1_TIMEOUT_MS: '0' })).toThrow(
      /M1_TIMEOUT_MS/,
    );
  });
});
