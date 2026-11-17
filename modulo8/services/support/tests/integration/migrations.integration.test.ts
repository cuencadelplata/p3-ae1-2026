import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, SupportSchemaMissingError } from '../../src/db/migrations.js';
import { createEphemeralSchema, type EphemeralSchema } from './helpers/ephemeral-schema.js';

let db: EphemeralSchema;

beforeEach(async () => {
  db = await createEphemeralSchema();
});

afterEach(async () => {
  await db.drop();
});

async function tablas() {
  const { rows } = await db.pool.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [db.schema],
  );
  return rows.map((row) => row.table_name);
}

async function insertarTicket(id: string, status = 'ABIERTO') {
  await db.pool.query(
    `INSERT INTO ${db.schema}.tickets (id, trip_id, reason, status, correlation_id, created_at, updated_at)
     VALUES ($1, 'trip-1', 'Demora', $2, 'trip-1', now(), now())`,
    [id, status],
  );
}

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

describe('migraciones de Support', () => {
  it('crean las tablas esperadas dentro del schema', async () => {
    await runMigrations(db.pool, db.schema);

    expect(await tablas()).toEqual(['idempotency_keys', 'ticket_history', 'tickets']);
  });

  it('crean los índices de viaje, estado, listado e historial', async () => {
    await runMigrations(db.pool, db.schema);

    const { rows } = await db.pool.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [db.schema]);
    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'tickets_pkey',
        'tickets_trip_id_idx',
        'tickets_status_idx',
        'tickets_created_at_id_idx',
        'ticket_history_pkey',
        'ticket_history_ticket_id_idx',
        'idempotency_keys_pkey',
      ]),
    );
  });

  it('crean las claves foráneas hacia tickets', async () => {
    await runMigrations(db.pool, db.schema);

    const { rows } = await db.pool.query(
      `SELECT table_name FROM information_schema.table_constraints
        WHERE table_schema = $1 AND constraint_type = 'FOREIGN KEY' ORDER BY table_name`,
      [db.schema],
    );
    expect(rows.map((row) => row.table_name)).toEqual(['idempotency_keys', 'ticket_history']);
  });

  it('guardan las fechas con precisión de milisegundos', async () => {
    await runMigrations(db.pool, db.schema);

    const { rows } = await db.pool.query(
      `SELECT table_name, column_name, datetime_precision FROM information_schema.columns
        WHERE table_schema = $1 AND data_type = 'timestamp with time zone'`,
      [db.schema],
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.datetime_precision === 3)).toBe(true);
  });

  it('pueden ejecutarse dos veces seguidas sin error ni pérdida de datos', async () => {
    await runMigrations(db.pool, db.schema);
    await insertarTicket(TICKET_ID);

    await expect(runMigrations(db.pool, db.schema)).resolves.toBeUndefined();

    expect(await tablas()).toEqual(['idempotency_keys', 'ticket_history', 'tickets']);
    const { rowCount } = await db.pool.query(`SELECT 1 FROM ${db.schema}.tickets WHERE id = $1`, [TICKET_ID]);
    expect(rowCount).toBe(1);
  });

  it('dos instancias pueden ejecutarlas en paralelo sin error', async () => {
    const otraInstancia = db.newPool();

    const resultados = await Promise.allSettled([
      runMigrations(db.pool, db.schema),
      runMigrations(otraInstancia, db.schema),
      runMigrations(db.pool, db.schema),
      runMigrations(otraInstancia, db.schema),
    ]);

    expect(resultados.map((resultado) => resultado.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(await tablas()).toEqual(['idempotency_keys', 'ticket_history', 'tickets']);
  });

  it('el CHECK del enum rechaza un estado inválido', async () => {
    await runMigrations(db.pool, db.schema);

    await expect(insertarTicket(TICKET_ID, 'CERRADO')).rejects.toMatchObject({
      code: '23514',
      constraint: 'tickets_status_check',
    });
    await expect(insertarTicket(TICKET_ID, 'RESUELTO')).resolves.toBeUndefined();
  });

  it('el historial rechaza estados inválidos y tickets inexistentes', async () => {
    await runMigrations(db.pool, db.schema);
    await insertarTicket(TICKET_ID);
    const insertar = (ticketId: string, toStatus: string) =>
      db.pool.query(
        `INSERT INTO ${db.schema}.ticket_history (ticket_id, from_status, to_status, changed_at)
         VALUES ($1, NULL, $2, now())`,
        [ticketId, toStatus],
      );

    await expect(insertar(TICKET_ID, 'CERRADO')).rejects.toMatchObject({ code: '23514' });
    await expect(insertar('22222222-2222-4222-8222-222222222222', 'ABIERTO')).rejects.toMatchObject({ code: '23503' });
    await expect(insertar(TICKET_ID, 'ABIERTO')).resolves.toBeDefined();
  });

  it('la clave de idempotencia es única', async () => {
    await runMigrations(db.pool, db.schema);
    await insertarTicket(TICKET_ID);
    const insertar = () =>
      db.pool.query(
        `INSERT INTO ${db.schema}.idempotency_keys (key, request_hash, ticket_id, created_at)
         VALUES ('clave-1', 'hash', $1, now())`,
        [TICKET_ID],
      );

    await insertar();
    await expect(insertar()).rejects.toMatchObject({ code: '23505' });
  });

  it('si el schema no existe fallan con un mensaje que indica cómo crearlo', async () => {
    const error = await runMigrations(db.pool, 'support_test_inexistente').catch((reason) => reason);

    expect(error).toBeInstanceOf(SupportSchemaMissingError);
    expect(error.message).toContain('"support_test_inexistente" no existe');
    expect(error.message).toContain('docker compose exec postgres sh /docker-entrypoint-initdb.d/02-support.sh');
  });

  it('no crean el schema: eso es del init de PostgreSQL', async () => {
    await runMigrations(db.pool, 'support_test_inexistente').catch(() => undefined);

    const { rowCount } = await db.pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'support_test_inexistente'`);
    expect(rowCount).toBe(0);
  });

  it('rechazan un nombre de schema que no es un identificador simple', async () => {
    await expect(runMigrations(db.pool, 'support; DROP SCHEMA receipts')).rejects.toThrow(/identificador simple/);
  });
});
