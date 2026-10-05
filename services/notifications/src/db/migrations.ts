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
  {
    version: 4,
    name: "align_notification_outbox_delivery_contract",
    statements: [
      `DO $$
       BEGIN
         IF to_regclass('notifications.outbox_events') IS NOT NULL
            AND to_regclass('notifications.outbox_deliveries') IS NULL THEN
           ALTER TABLE notifications.outbox_events RENAME TO outbox_deliveries;
         END IF;
       END $$`,
      `DO $$
       DECLARE
         constraint_name text;
       BEGIN
         SELECT conname INTO constraint_name
           FROM pg_constraint
          WHERE conrelid = 'notifications.outbox_deliveries'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%producer%'
          LIMIT 1;

         IF constraint_name IS NOT NULL THEN
           EXECUTE format('ALTER TABLE notifications.outbox_deliveries DROP CONSTRAINT %I', constraint_name);
         END IF;
       END $$`,
      `UPDATE notifications.outbox_deliveries
          SET producer = 'm8-notifications'
        WHERE producer = 'm8'`,
      `ALTER TABLE notifications.outbox_deliveries
         ADD CONSTRAINT notifications_outbox_deliveries_producer_check
         CHECK (producer = 'm8-notifications')`,
      `UPDATE notifications.outbox_deliveries o
          SET payload = jsonb_build_object(
            'notificationId', n.notification_id::text,
            'tripId', n.trip_id,
            'recipientId', n.recipient_id,
            'eventType', CASE n.event_type
              WHEN 'TripRequested' THEN 'TRIP_REQUESTED'
              WHEN 'TripAssigned' THEN 'DRIVER_ASSIGNED'
              WHEN 'DriverArrived' THEN 'DRIVER_ARRIVED'
              WHEN 'TripStarted' THEN 'TRIP_STARTED'
              WHEN 'TripCancelled' THEN 'TRIP_CANCELLED'
              WHEN 'TripCompleted' THEN 'TRIP_COMPLETED'
            END,
            'channel', 'PUSH',
            'message', n.message,
            'createdAt', to_jsonb(to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) #>> '{}'
          )
         FROM notifications.notifications n
        WHERE n.notification_id = o.notification_id
          AND o.payload IS NULL`,
      `ALTER TABLE notifications.outbox_deliveries
         ALTER COLUMN payload SET NOT NULL`,
      `DROP INDEX IF EXISTS notifications.notifications_outbox_pending_created_at_idx`,
      `CREATE INDEX IF NOT EXISTS notifications_outbox_deliveries_pending_created_at_idx
       ON notifications.outbox_deliveries (created_at, message_id)
       WHERE published_at IS NULL`,
    ],
  },
  {
    version: 5,
    name: "support_ride_requested_without_trip_id",
    statements: [
      `ALTER TABLE notifications.notifications
         ADD COLUMN IF NOT EXISTS ride_request_id text NULL`,
      `ALTER TABLE notifications.notifications
         ALTER COLUMN trip_id DROP NOT NULL`,
      `UPDATE notifications.notifications
          SET ride_request_id = trip_id,
              trip_id = NULL
        WHERE event_type = 'TripRequested'
          AND ride_request_id IS NULL
          AND trip_id IS NOT NULL`,
      `UPDATE notifications.outbox_deliveries o
          SET payload = (o.payload - 'tripId') || jsonb_build_object('rideRequestId', n.ride_request_id)
         FROM notifications.notifications n
        WHERE n.notification_id = o.notification_id
          AND n.event_type = 'TripRequested'
          AND n.ride_request_id IS NOT NULL
          AND o.payload ? 'tripId'`,
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
             FROM pg_constraint
            WHERE conname = 'notifications_context_reference_check'
              AND conrelid = 'notifications.notifications'::regclass
         ) THEN
           ALTER TABLE notifications.notifications
             ADD CONSTRAINT notifications_context_reference_check
             CHECK (
               (event_type = 'TripRequested' AND ride_request_id IS NOT NULL AND trip_id IS NULL)
               OR
               (event_type <> 'TripRequested' AND trip_id IS NOT NULL)
             );
         END IF;
       END $$`,
    ],
  },
] as const;

export async function runMigrations(pool: Pool): Promise<void> {
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    const schema = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
      ["notifications"],
    );
    if (schema.rows[0].exists !== true) {
      await client.query("CREATE SCHEMA notifications");
    }
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
