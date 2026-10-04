import type { Pool } from 'pg';
import { assertSchemaIdentifier } from './config.js';

/**
 * Esquema de datos de Support (RF-8.5). Las sentencias son idempotentes para
 * poder ejecutarse en cada arranque, también sobre un volumen PostgreSQL que
 * ya existía.
 *
 * Sólo crean objetos DENTRO del schema. El schema y el rol son
 * infraestructura: los crea infra/postgres/init/02-support.sh.
 *
 * - tickets: el ticket. trip_id es un string opaco definido por otro módulo.
 *   version sostiene el control optimista de los cambios de estado.
 * - ticket_history: historial de estados, sólo por inserción. from_status es
 *   null en la entrada inicial, creada junto con el ticket.
 * - idempotency_keys: una fila por Idempotency-Key usada en POST /tickets. La
 *   clave primaria garantiza a lo sumo un ticket por clave, también entre
 *   instancias; request_hash distingue un reintento de un pedido distinto.
 *
 * Las fechas son timestamptz(3): precisión de milisegundos, la misma que
 * maneja la aplicación. Así el cursor del listado (fecha de creación + id)
 * compara exactamente igual que en el repositorio en memoria.
 */
function statements(schema: string): string[] {
  const estados = `('ABIERTO', 'EN_PROCESO', 'RESUELTO')`;

  return [
    `CREATE TABLE IF NOT EXISTS ${schema}.tickets (
       id             uuid           PRIMARY KEY,
       trip_id        text           NOT NULL,
       reason         text           NOT NULL,
       status         text           NOT NULL,
       version        integer        NOT NULL DEFAULT 1,
       correlation_id text           NOT NULL,
       created_at     timestamptz(3) NOT NULL,
       updated_at     timestamptz(3) NOT NULL,
       CONSTRAINT tickets_status_check CHECK (status IN ${estados}),
       CONSTRAINT tickets_version_check CHECK (version >= 1)
     )`,
    `CREATE INDEX IF NOT EXISTS tickets_trip_id_idx ON ${schema}.tickets (trip_id)`,
    `CREATE INDEX IF NOT EXISTS tickets_status_idx ON ${schema}.tickets (status)`,
    `CREATE INDEX IF NOT EXISTS tickets_created_at_id_idx ON ${schema}.tickets (created_at DESC, id DESC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.ticket_history (
       id          bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       ticket_id   uuid           NOT NULL REFERENCES ${schema}.tickets (id),
       from_status text,
       to_status   text           NOT NULL,
       changed_by  text,
       reason      text,
       changed_at  timestamptz(3) NOT NULL,
       CONSTRAINT ticket_history_from_status_check CHECK (from_status IS NULL OR from_status IN ${estados}),
       CONSTRAINT ticket_history_to_status_check CHECK (to_status IN ${estados})
     )`,
    `CREATE INDEX IF NOT EXISTS ticket_history_ticket_id_idx
       ON ${schema}.ticket_history (ticket_id, changed_at, id)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.idempotency_keys (
       key          text           PRIMARY KEY,
       request_hash text           NOT NULL,
       ticket_id    uuid           NOT NULL REFERENCES ${schema}.tickets (id),
       created_at   timestamptz(3) NOT NULL
     )`,
  ];
}

/** Clave arbitraria del bloqueo consultivo que serializa las migraciones de Support. */
const MIGRATION_LOCK_KEY = 8_005_001;

const SCHEMA_SETUP_COMMAND = 'docker compose exec postgres sh /docker-entrypoint-initdb.d/02-support.sh';

/** El schema de Support todavía no existe en la base: falta correr el init. */
export class SupportSchemaMissingError extends Error {
  constructor(schema: string) {
    super(
      `El schema "${schema}" no existe en la base de datos. Lo crea infra/postgres/init/02-support.sh; ` +
        `en un volumen PostgreSQL ya existente ejecutá: ${SCHEMA_SETUP_COMMAND}`,
    );
    this.name = 'SupportSchemaMissingError';
  }
}

/**
 * Dos instancias que arrancan a la vez pueden chocar al crear las mismas
 * tablas aunque usen IF NOT EXISTS. El bloqueo consultivo de la transacción
 * hace que la segunda espere a la primera.
 */
export async function runMigrations(pool: Pool, schema: string): Promise<void> {
  assertSchemaIdentifier(schema);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Una migración puede esperar a otra instancia: no aplica el límite corto
    // de las consultas de la API.
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);

    const { rowCount } = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
    if (rowCount === 0) {
      throw new SupportSchemaMissingError(schema);
    }

    for (const statement of statements(schema)) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
