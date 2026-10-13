import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadM6TripsConfig } from './config/env.js';
import { checkSupportReadiness } from './http/readiness.js';
import type { TripVerifier } from './integrations/m6-trips.js';
import { InMemoryTicketRepository } from './models/ticket.model.js';
import { buildSupportFromEnv, createSupportRuntime } from './support-runtime.js';

const DATABASE_URL = 'postgres://m8_support:secreto@127.0.0.1:1/m8';
const CONFIG = { port: 0, rabbitUrl: 'amqp://test', legacyEvents: false };

function database(available: boolean, migrationsApplied: boolean) {
  return { isAvailable: async () => available, migrationsApplied };
}

function verificador(alcanzable: boolean, existe = true): TripVerifier {
  return { existe: async () => existe, isReachable: async () => alcanzable };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadM6TripsConfig', () => {
  it('sin M6_TRIPS_URL, o vacía, la verificación queda desactivada', () => {
    expect(loadM6TripsConfig({})).toBeUndefined();
    expect(loadM6TripsConfig({ M6_TRIPS_URL: '   ' })).toBeUndefined();
  });

  it('usa 2000 ms de timeout por defecto y quita la barra final de la URL', () => {
    expect(loadM6TripsConfig({ M6_TRIPS_URL: 'http://m6:3000/' })).toEqual({ baseUrl: 'http://m6:3000', timeoutMs: 2000 });
  });

  it('toma el timeout de M6_TIMEOUT_MS', () => {
    expect(loadM6TripsConfig({ M6_TRIPS_URL: 'http://m6:3000', M6_TIMEOUT_MS: '750' })).toEqual({
      baseUrl: 'http://m6:3000',
      timeoutMs: 750,
    });
  });

  it.each(['0', '-5', '1.5', 'rapido'])('rechaza M6_TIMEOUT_MS="%s"', (valor) => {
    expect(() => loadM6TripsConfig({ M6_TRIPS_URL: 'http://m6:3000', M6_TIMEOUT_MS: valor })).toThrow(/M6_TIMEOUT_MS/);
  });

  it('sin M6_TRIPS_URL no valida M6_TIMEOUT_MS', () => {
    expect(loadM6TripsConfig({ M6_TIMEOUT_MS: 'rapido' })).toBeUndefined();
  });
});

describe('checkSupportReadiness con el servicio de viajes de M6', () => {
  it('ok: M6 responde', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), trips: async () => true });

    expect(readiness.status).toBe('ok');
    expect(readiness.checks.trips).toEqual({ status: 'available', critical: false });
  });

  it('degraded: la base está bien pero M6 no responde', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), trips: async () => false });

    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.trips).toEqual({ status: 'unavailable', critical: false });
  });

  it('unavailable: la base caída pesa más que M6', async () => {
    const readiness = await checkSupportReadiness({ database: database(false, true), trips: async () => true });

    expect(readiness.status).toBe('unavailable');
  });

  it('sin verificación habilitada no informa el check', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true) });

    expect(readiness.checks.trips).toBeUndefined();
  });
});

describe('createSupportRuntime con verificador de viajes', () => {
  it('M6 caído deja a Support degraded, nunca unavailable: /health/ready responde 200', async () => {
    const runtime = createSupportRuntime(CONFIG, new InMemoryTicketRepository(), database(true, true), true, verificador(false));

    const res = await request(runtime.app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.trips).toEqual({ status: 'unavailable', critical: false });
  });

  it('usa el verificador al crear tickets', async () => {
    const runtime = createSupportRuntime(
      CONFIG,
      new InMemoryTicketRepository(),
      database(true, true),
      true,
      verificador(true, false),
    );

    const res = await request(runtime.app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUPPORT_TRIP_NOT_FOUND');
  });

  it('sin verificador no informa el check de viajes', async () => {
    const runtime = createSupportRuntime(CONFIG, new InMemoryTicketRepository(), database(true, true));

    expect((await runtime.readiness()).checks.trips).toBeUndefined();
  });
});

describe('buildSupportFromEnv y M6_TRIPS_URL', () => {
  const ENV = { SUPPORT_DATABASE_URL: DATABASE_URL, SUPPORT_LEGACY_EVENTS: 'off' };

  it('sin M6_TRIPS_URL arranca sin verificación y lo avisa en el log', async () => {
    const support = buildSupportFromEnv(ENV);

    expect((await support.readiness()).checks.trips).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('M6_TRIPS_URL'));
    await support.pool.end();
  });

  it('con M6_TRIPS_URL consulta el /health de esa URL para el readiness', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const support = buildSupportFromEnv({ ...ENV, M6_TRIPS_URL: 'http://m6.test:3000/' });
    const readiness = await support.readiness();

    expect(readiness.checks.trips).toEqual({ status: 'available', critical: false });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://m6.test:3000/health']);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('M6_TRIPS_URL'));
    await support.pool.end();
  });

  it('rechaza un M6_TIMEOUT_MS inválido antes de arrancar', () => {
    expect(() => buildSupportFromEnv({ ...ENV, M6_TRIPS_URL: 'http://m6.test:3000', M6_TIMEOUT_MS: '0' })).toThrow(
      /M6_TIMEOUT_MS/,
    );
  });
});
