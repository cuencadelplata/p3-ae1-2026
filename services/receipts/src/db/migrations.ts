import { pool } from './pool';

/**
 * Esquema del servicio de comprobantes. Las sentencias son idempotentes para
 * poder ejecutarse en cada arranque.
 *
 * - receipts: el comprobante. Cliente, conductor, recorrido, tarifa y pago se
 *   guardan como una foto inmutable de los datos recibidos al emitir, por eso
 *   se almacenan en jsonb y no como tablas relacionadas. La restriccion UNIQUE
 *   sobre trip_id es la que garantiza un unico comprobante por viaje, aun con
 *   varias instancias del servicio (RNF-09). La columna fiscal guarda la
 *   autorizacion otorgada por el autorizador fiscal externo.
 * - receipt_documents: el PDF, identificado por una clave opaca que no deriva
 *   del tripId. Se inserta en la misma transaccion que el comprobante.
 * - receipt_deliveries: historial de reenvios, solo por insercion.
 * - processed_messages: bandeja de entrada del consumidor. Registra el
 *   messageId de cada evento ya procesado para descartar las reentregas de
 *   RabbitMQ (RNF-08).
 * - outbox_events: bandeja de salida. Cada evento a publicar se inserta en la
 *   misma transaccion que el cambio que lo origina; published_at queda en null
 *   hasta que RabbitMQ confirma la recepcion.
 */
const statements = [
  `CREATE TABLE IF NOT EXISTS receipts.receipts (
     receipt_id     uuid        PRIMARY KEY,
     receipt_number text        NOT NULL UNIQUE,
     trip_id        text        NOT NULL,
     issued_at      timestamptz NOT NULL,
     customer       jsonb       NOT NULL,
     driver         jsonb       NOT NULL,
     trip           jsonb       NOT NULL,
     fare           jsonb       NOT NULL,
     payment        jsonb       NOT NULL,
     created_at     timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT receipts_trip_id_key UNIQUE (trip_id)
   )`,
  // Autorizacion del autorizador fiscal externo (v2.1.0). Se agrega con ALTER
  // para que los volumenes creados antes la incorporen sin recrearse; queda
  // nula en los comprobantes emitidos antes de este cambio.
  `ALTER TABLE receipts.receipts ADD COLUMN IF NOT EXISTS fiscal jsonb`,
  `CREATE TABLE IF NOT EXISTS receipts.receipt_documents (
     pdf_key      uuid        PRIMARY KEY,
     receipt_id   uuid        NOT NULL UNIQUE REFERENCES receipts.receipts (receipt_id),
     content_type text        NOT NULL,
     size_bytes   integer     NOT NULL,
     content      bytea       NOT NULL,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS receipts.receipt_deliveries (
     delivery_id bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     receipt_id  uuid        NOT NULL REFERENCES receipts.receipts (receipt_id),
     channel     text        NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'PUSH')),
     destination text        NOT NULL,
     sent_at     timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS receipt_deliveries_receipt_id_idx
     ON receipts.receipt_deliveries (receipt_id, sent_at)`,
  `CREATE TABLE IF NOT EXISTS receipts.processed_messages (
     message_id     uuid        PRIMARY KEY,
     event_type     text        NOT NULL,
     correlation_id text        NOT NULL,
     processed_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS receipts.outbox_events (
     message_id     uuid        PRIMARY KEY,
     event_type     text        NOT NULL,
     routing_key    text        NOT NULL,
     correlation_id text        NOT NULL,
     envelope       jsonb       NOT NULL,
     created_at     timestamptz NOT NULL DEFAULT now(),
     published_at   timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
     ON receipts.outbox_events (created_at) WHERE published_at IS NULL`,
];

/** Clave arbitraria del bloqueo consultivo que serializa las migraciones. */
const MIGRATION_LOCK_KEY = 8_003_001;

/**
 * Dos instancias que arrancan a la vez pueden chocar al crear las mismas tablas
 * aunque usen IF NOT EXISTS. El bloqueo consultivo de la transaccion hace que
 * la segunda espere a la primera.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
