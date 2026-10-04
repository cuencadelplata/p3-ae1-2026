import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportDatabase } from '../../src/db/database.js';
import { createSupportPool } from '../../src/db/pool.js';
import { checkSupportReadiness } from '../../src/http/readiness.js';
import { createEphemeralSchema, type EphemeralSchema } from './helpers/ephemeral-schema.js';

let db: EphemeralSchema;

beforeEach(async () => {
  db = await createEphemeralSchema();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.drop();
});

describe('SupportDatabase contra PostgreSQL real', () => {
  it('prepare aplica las migraciones y deja el readiness en ok', async () => {
    const database = new SupportDatabase({ pool: db.pool, schema: db.schema, retryMs: 100 });

    expect((await checkSupportReadiness({ database })).status).toBe('unavailable');
    await database.prepare();

    expect(await checkSupportReadiness({ database })).toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'available', critical: true },
        migrations: { status: 'applied', critical: true },
      },
    });
  });

  it('si falta el schema reintenta, informa el comando y se recupera cuando el schema aparece', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const schema = `${db.schema}_tarde`;
    const database = new SupportDatabase({ pool: db.pool, schema, retryMs: 100 });

    const preparing = database.prepare();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled(), { timeout: 5000 });
    expect(database.migrationsApplied).toBe(false);
    expect(consoleError.mock.calls[0][0]).toContain('02-support.sh');

    await db.pool.query(`CREATE SCHEMA ${schema}`);
    try {
      await preparing;
      expect(database.migrationsApplied).toBe(true);
    } finally {
      await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });

  it('con la base inalcanzable isAvailable responde false rápido, sin colgarse', async () => {
    const pool = createSupportPool('postgres://m8_support:x@127.0.0.1:1/m8');
    const database = new SupportDatabase({ pool, schema: 'support', retryMs: 100 });

    const inicio = Date.now();
    const disponible = await database.isAvailable();

    expect(disponible).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(4500);
    expect((await checkSupportReadiness({ database })).status).toBe('unavailable');
    await pool.end();
  });

  it('con una contraseña incorrecta no queda disponible', async () => {
    const pool = createSupportPool('postgres://m8_admin:incorrecta@localhost:5432/m8');
    const database = new SupportDatabase({ pool, schema: 'support', retryMs: 100 });

    expect(await database.isAvailable()).toBe(false);
    await pool.end();
  });
});
