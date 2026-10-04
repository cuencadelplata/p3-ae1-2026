import type { Pool } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";

const MIGRATION_LOCK_KEY = 8_001_001;

const migrations = [
  {
    version: 1,
    name: "create_notifications_table",
    statements: [
      `CREATE TABLE IF NOT EXISTS notifications.notifications (
         notification_id uuid PRIMARY KEY,
         source_message_id text NOT NULL,
         trip_id text NOT NULL,
         recipient_id text NOT NULL,
         event_type text NOT NULL CHECK (event_type IN (
           'TripRequested', 'TripAssigned', 'DriverArrived',
           'TripStarted', 'TripCancelled', 'TripCompleted'
         )),
         title text NOT NULL,
         message text NOT NULL,
         correlation_id text NOT NULL,
         occurred_at timestamptz NOT NULL,
         created_at timestamptz NOT NULL,
         CONSTRAINT notifications_source_message_recipient_key
           UNIQUE (source_message_id, recipient_id)
       )`,
    ],
  },
  {
    version: 2,
    name: "create_notification_outbox_table",
    statements: [
      `CREATE TABLE IF NOT EXISTS notifications.outbox_events (
         message_id uuid PRIMARY KEY,
         notification_id uuid NOT NULL REFERENCES notifications.notifications (notification_id),
         event_type text NOT NULL CHECK (event_type = 'NotificationRequested'),
         routing_key text NOT NULL CHECK (routing_key = 'notification.requested'),
         correlation_id text NOT NULL,
         version integer NOT NULL CHECK (version = 1),
         producer text NOT NULL CHECK (producer = 'm8'),
         payload jsonb NULL,
         created_at timestamptz NOT NULL,
         published_at timestamptz NULL,
         CONSTRAINT notifications_outbox_notification_event_key UNIQUE (notification_id, event_type)
      )`,
    ],
  },
  {
    version: 3,
    name: "create_notification_outbox_pending_index",
    statements: [
      `CREATE INDEX IF NOT EXISTS notifications_outbox_pending_created_at_idx
       ON notifications.outbox_events (created_at, message_id)
       WHERE published_at IS NULL`,
    ],
  },
] as const;

export async function runMigrations(pool: Pool): Promise<void> {
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query("CREATE SCHEMA IF NOT EXISTS notifications");
    await client.query(`CREATE TABLE IF NOT EXISTS notifications.schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    for (const migration of migrations) {
      const applied = await client.query<{ version: number }>(
        "SELECT version FROM notifications.schema_migrations WHERE version = $1",
        [migration.version],
      );

      if (applied.rowCount === 0) {
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query(
          "INSERT INTO notifications.schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    if (client !== undefined) {
      await client.query("ROLLBACK");
    }
    throw new NotificationPersistenceError("No se pudieron ejecutar las migraciones de Notifications.", error);
  } finally {
    client?.release();
  }
}
