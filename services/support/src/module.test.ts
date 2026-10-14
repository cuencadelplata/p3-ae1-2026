import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportModule, type SupportModule } from './module.js';

// createSupportModule es lo que monta la app común de M8 (el contenedor
// m8-app). Lee process.env; la base apunta a un puerto cerrado para no
// depender de PostgreSQL.
const DATABASE_URL = 'postgres://m8_support@127.0.0.1:1/m8';

let modulo: SupportModule | undefined;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

// Igual que la app común: el cuerpo JSON lo parsea un middleware montado antes.
function appCon(m: SupportModule) {
  const app = express();
  app.use(express.json());
  app.use(m.router);
  return app;
}

function crearModulo(env: Record<string, string>) {
  vi.stubEnv('SUPPORT_DATABASE_URL', DATABASE_URL);
  vi.stubEnv('SUPPORT_LEGACY_EVENTS', 'off');
  vi.stubEnv('M6_TRIPS_URL', '');
  vi.stubEnv('SUPPORT_M1_IDENTITY_URL', '');
  for (const [nombre, valor] of Object.entries(env)) {
    vi.stubEnv(nombre, valor);
  }
  modulo = createSupportModule();
  return modulo;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  fetchMock = vi.fn<typeof fetch>(async () => new Response('{"status":"ok"}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await modulo?.stop();
  modulo = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSupportModule con SUPPORT_M1_IDENTITY_URL y M6_TRIPS_URL', () => {
  const ENV = { SUPPORT_M1_IDENTITY_URL: 'http://m1.test:3001', M6_TRIPS_URL: 'http://m6.test:3000' };

  it('es el módulo "support" que espera la app común', () => {
    const m = crearModulo(ENV);

    expect(m.name).toBe('support');
    expect(typeof m.readiness).toBe('function');
  });

  it.each([
    ['POST /tickets', (app: express.Express) => request(app).post('/tickets').send({ tripId: 't', motivo: 'm' })],
    ['GET /tickets', (app: express.Express) => request(app).get('/tickets')],
    ['GET /tickets/:id', (app: express.Express) => request(app).get('/tickets/x')],
    ['PATCH /tickets/:id/estado', (app: express.Express) => request(app).patch('/tickets/x/estado').send({ estado: 'RESUELTO' })],
    ['GET /tickets/:id/historial', (app: express.Express) => request(app).get('/tickets/x/historial')],
  ])('%s sin Bearer responde 401 SUPPORT_AUTH_REQUIRED', async (_ruta, pedir) => {
    const res = await pedir(appCon(crearModulo(ENV)));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SUPPORT_AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con Bearer valida el token contra la URL de M1 configurada', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"valid":false}', { status: 200 }));

    const res = await request(appCon(crearModulo(ENV))).get('/tickets').set('Authorization', 'Bearer abc');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SUPPORT_INVALID_TOKEN');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://m1.test:3001/auth/validar-identidad-y-rol']);
  });

  it('readiness incluye los checks trips e identity, consultando el /health de cada uno', async () => {
    const readiness = await crearModulo(ENV).readiness();

    expect(readiness.checks.trips).toEqual({ status: 'available', critical: false });
    expect(readiness.checks.identity).toEqual({ status: 'available', critical: false });
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      'http://m1.test:3001/health',
      'http://m6.test:3000/health',
    ]);
  });
});

describe('createSupportModule sin SUPPORT_M1_IDENTITY_URL ni M6_TRIPS_URL', () => {
  it('las rutas de /tickets no exigen Bearer: el pedido llega al repositorio', async () => {
    const res = await request(appCon(crearModulo({}))).get('/tickets');

    // La base de la prueba está caída: lo que importa es que no hubo 401.
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SUPPORT_DB_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('readiness no informa trips ni identity ni consulta a otros módulos', async () => {
    const readiness = await crearModulo({}).readiness();

    expect(readiness.checks.trips).toBeUndefined();
    expect(readiness.checks.identity).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M1_IDENTITY_URL (la variable de Receipts) no activa la autenticación', async () => {
    const m = crearModulo({ M1_IDENTITY_URL: 'http://m1-identity-sandbox:4011/auth/validar-identidad-y-rol' });

    const res = await request(appCon(m)).get('/tickets');

    expect(res.status).not.toBe(401);
  });
});

describe('createSupportModule con una sola integración', () => {
  it('sólo M6_TRIPS_URL: no exige Bearer e informa sólo trips', async () => {
    const m = crearModulo({ M6_TRIPS_URL: 'http://m6.test:3000' });

    const res = await request(appCon(m)).get('/tickets');
    const readiness = await m.readiness();

    expect(res.status).not.toBe(401);
    expect(readiness.checks.trips).toBeDefined();
    expect(readiness.checks.identity).toBeUndefined();
  });

  it('sólo SUPPORT_M1_IDENTITY_URL: exige Bearer e informa sólo identity', async () => {
    const m = crearModulo({ SUPPORT_M1_IDENTITY_URL: 'http://m1.test:3001' });

    const res = await request(appCon(m)).get('/tickets');
    const readiness = await m.readiness();

    expect(res.status).toBe(401);
    expect(readiness.checks.identity).toBeDefined();
    expect(readiness.checks.trips).toBeUndefined();
  });
});
