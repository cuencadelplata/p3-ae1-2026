import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDatabaseRetryMs } from './config.js';
import { describeDatabaseError, SupportDatabase } from './database.js';
import { SupportSchemaMissingError } from './migrations.js';

const SETUP_COMMAND = 'docker compose exec postgres sh /docker-entrypoint-initdb.d/02-support.sh';

function fakePool(query: () => Promise<unknown>) {
  return { query: vi.fn(query) } as unknown as Pool;
}

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SupportDatabase.prepare', () => {
  it('marca las migraciones como aplicadas cuando terminan bien', async () => {
    const migrate = vi.fn(async () => undefined);
    const database = new SupportDatabase({ pool: fakePool(async () => ({})), schema: 'support', retryMs: 5000, migrate });

    expect(database.migrationsApplied).toBe(false);
    await database.prepare();

    expect(database.migrationsApplied).toBe(true);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('con la base caída no lanza: reintenta con espera hasta lograrlo', async () => {
    const migrate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(pgError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'))
      .mockRejectedValueOnce(pgError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'))
      .mockResolvedValue(undefined);
    const database = new SupportDatabase({ pool: fakePool(async () => ({})), schema: 'support', retryMs: 5000, migrate });

    const preparing = database.prepare();
    await vi.advanceTimersByTimeAsync(0);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(database.migrationsApplied).toBe(false);

    await vi.advanceTimersByTimeAsync(4999);
    expect(migrate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(migrate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    await preparing;
    expect(migrate).toHaveBeenCalledTimes(3);
    expect(database.migrationsApplied).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError.mock.calls[0][0]).toContain('PostgreSQL no está disponible');
  });

  it('si falta el schema, el log indica el comando de 02-support.sh', async () => {
    const migrate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new SupportSchemaMissingError('support'))
      .mockResolvedValue(undefined);
    const database = new SupportDatabase({ pool: fakePool(async () => ({})), schema: 'support', retryMs: 1000, migrate });

    const preparing = database.prepare();
    await vi.advanceTimersByTimeAsync(1000);
    await preparing;

    expect(consoleError.mock.calls[0][0]).toContain('El schema "support" no existe');
    expect(consoleError.mock.calls[0][0]).toContain(SETUP_COMMAND);
  });

  it('stop() corta los reintentos', async () => {
    const migrate = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('caída'));
    const database = new SupportDatabase({ pool: fakePool(async () => ({})), schema: 'support', retryMs: 1000, migrate });

    const preparing = database.prepare();
    await vi.advanceTimersByTimeAsync(0);
    database.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await preparing;

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(database.migrationsApplied).toBe(false);
  });
});

describe('SupportDatabase.isAvailable', () => {
  it('true si la base responde', async () => {
    const database = new SupportDatabase({ pool: fakePool(async () => ({ rows: [] })), schema: 'support', retryMs: 1 });

    expect(await database.isAvailable()).toBe(true);
  });

  it('false si la consulta falla, sin lanzar', async () => {
    const pool = fakePool(async () => {
      throw new Error('timeout exceeded when trying to connect');
    });
    const database = new SupportDatabase({ pool, schema: 'support', retryMs: 1 });

    expect(await database.isAvailable()).toBe(false);
  });
});

describe('describeDatabaseError', () => {
  it.each([
    ['el rol no existe', '28000', 'role "m8_support" does not exist'],
    ['la contraseña no coincide', '28P01', 'password authentication failed for user "m8_support"'],
    ['el rol no tiene permisos', '42501', 'permission denied for schema support'],
  ])('si %s indica el comando de 02-support.sh', (_caso, code, message) => {
    const descripcion = describeDatabaseError(pgError(code, message));

    expect(descripcion).toContain(message);
    expect(descripcion).toContain(SETUP_COMMAND);
  });

  it('una base caída no sugiere correr el init', () => {
    const descripcion = describeDatabaseError(pgError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'));

    expect(descripcion).toContain('PostgreSQL no está disponible');
    expect(descripcion).not.toContain(SETUP_COMMAND);
  });
});

describe('loadDatabaseRetryMs', () => {
  it('usa 5000 ms por defecto y acepta SUPPORT_DB_RETRY_MS', () => {
    expect(loadDatabaseRetryMs({})).toBe(5000);
    expect(loadDatabaseRetryMs({ SUPPORT_DB_RETRY_MS: '250' })).toBe(250);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rechaza "%s"', (valor) => {
    expect(() => loadDatabaseRetryMs({ SUPPORT_DB_RETRY_MS: valor })).toThrow(/SUPPORT_DB_RETRY_MS/);
  });
});
