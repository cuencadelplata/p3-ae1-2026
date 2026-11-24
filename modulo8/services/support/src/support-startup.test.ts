import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const amqpMock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ connect: amqpMock.connect }));

const DATABASE_URL = 'postgres://m8_support:secreto@127.0.0.1:1/m8';

function database(available: boolean, migrationsApplied: boolean) {
  return { isAvailable: async () => available, migrationsApplied };
}

// Cada test usa módulos nuevos.
async function loadRuntime() {
  return import('./support-runtime.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  amqpMock.connect.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSupportFromEnv', () => {
  it('sin SUPPORT_DATABASE_URL no arranca: no hay fallback a memoria', async () => {
    const { buildSupportFromEnv } = await loadRuntime();

    expect(() => buildSupportFromEnv({})).toThrow(/SUPPORT_DATABASE_URL es obligatoria/);
  });

  it('rechaza una configuración inválida antes de arrancar', async () => {
    const { buildSupportFromEnv } = await loadRuntime();

    expect(() => buildSupportFromEnv({ SUPPORT_DATABASE_URL: DATABASE_URL, SUPPORT_DB_SCHEMA: 'Mal Schema' })).toThrow(
      /SUPPORT_DB_SCHEMA/,
    );
    expect(() => buildSupportFromEnv({ SUPPORT_DATABASE_URL: DATABASE_URL, SUPPORT_DB_RETRY_MS: '0' })).toThrow(
      /SUPPORT_DB_RETRY_MS/,
    );
  });

  it('con la URL arma Support sin abrir conexiones a la base ni al broker', async () => {
    const { buildSupportFromEnv } = await loadRuntime();

    const support = buildSupportFromEnv({ SUPPORT_DATABASE_URL: DATABASE_URL });

    expect(support.pool.totalCount).toBe(0);
    expect(amqpMock.connect).not.toHaveBeenCalled();
    expect(support.database.migrationsApplied).toBe(false);
    await support.pool.end();
  });

  it('arranca aunque la base no responda: /health 200 y /health/ready 503', async () => {
    const { buildSupportFromEnv } = await loadRuntime();
    const support = buildSupportFromEnv({ SUPPORT_DATABASE_URL: DATABASE_URL });

    const health = await request(support.app).get('/health');
    const ready = await request(support.app).get('/health/ready');

    expect(health.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(ready.body.checks.postgres.status).toBe('unavailable');
    expect(ready.body.checks.migrations.status).toBe('pending');
    await support.pool.end();
  });
});

describe('readiness del runtime', () => {
  async function runtimeCon(db = database(true, true)) {
    const { createSupportRuntime } = await loadRuntime();
    const { InMemoryTicketRepository } = await import('./models/ticket.model.js');
    return createSupportRuntime({ port: 0 }, new InMemoryTicketRepository(), db);
  }

  it('con la base disponible: ok y sin check de RabbitMQ', async () => {
    const runtime = await runtimeCon();

    const readiness = await runtime.readiness();

    expect(readiness.status).toBe('ok');
    expect(Object.keys(readiness.checks).sort()).toEqual(['migrations', 'postgres']);
    expect((await request(runtime.app).get('/health/ready')).status).toBe(200);
  });

  it('con la base caída: unavailable', async () => {
    const runtime = await runtimeCon(database(false, true));

    expect((await runtime.readiness()).status).toBe('unavailable');
    expect((await request(runtime.app).get('/health/ready')).status).toBe(503);
  });
});
