import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";
import {
  M8_PRODUCER,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_ROUTING_KEY,
  NOTIFICATION_REQUESTED_VERSION,
  type NotificationOutboxIntent,
  type NotificationWithOutboxRepository,
  type SaveNotificationWithOutboxResult,
} from "../notifications/notification-outbox.repository";
import type { LogicalNotification } from "../notifications/notification.types";
import { saveNotificationIdempotent } from "./postgres-notification.repository";

interface OutboxRow {
  message_id: string;
  notification_id: string;
  event_type: typeof NOTIFICATION_REQUESTED_EVENT_TYPE;
  routing_key: typeof NOTIFICATION_REQUESTED_ROUTING_KEY;
  correlation_id: string;
  version: typeof NOTIFICATION_REQUESTED_VERSION;
  producer: typeof M8_PRODUCER;
  payload: null;
  created_at: Date;
  published_at: Date | null;
}

function mapOutboxRow(row: OutboxRow): NotificationOutboxIntent {
  return {
    messageId: row.message_id,
    notificationId: row.notification_id,
    eventType: row.event_type,
    routingKey: row.routing_key,
    correlationId: row.correlation_id,
    version: row.version,
    producer: row.producer,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}

async function ensureOutboxIntent(
  client: PoolClient,
  notification: LogicalNotification,
): Promise<NotificationOutboxIntent> {
  await client.query(
    `INSERT INTO notifications.outbox_events (
       message_id, notification_id, event_type, routing_key, correlation_id,
       version, producer, payload, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
     ON CONFLICT (notification_id, event_type) DO NOTHING`,
    [
      randomUUID(),
      notification.notificationId,
      NOTIFICATION_REQUESTED_EVENT_TYPE,
      NOTIFICATION_REQUESTED_ROUTING_KEY,
      notification.correlationId,
      NOTIFICATION_REQUESTED_VERSION,
      M8_PRODUCER,
      new Date().toISOString(),
    ],
  );

  const result = await client.query<OutboxRow>(
    `SELECT message_id, notification_id, event_type, routing_key, correlation_id,
            version, producer, payload, created_at, published_at
       FROM notifications.outbox_events
      WHERE notification_id = $1 AND event_type = $2`,
    [notification.notificationId, NOTIFICATION_REQUESTED_EVENT_TYPE],
  );

  if (result.rowCount !== 1) {
    throw new NotificationPersistenceError("No se encontró la intención Outbox persistida.");
  }

  return mapOutboxRow(result.rows[0]);
}

export function createPostgresNotificationWithOutboxRepository(
  pool: Pool,
): NotificationWithOutboxRepository {
  return {
    async saveWithOutbox(notification: LogicalNotification): Promise<SaveNotificationWithOutboxResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const saved = await saveNotificationIdempotent(client, notification);
        const outbox = await ensureOutboxIntent(client, saved.notification);
        await client.query("COMMIT");
        return { ...saved, outbox };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof NotificationPersistenceError) {
          throw error;
        }
        throw new NotificationPersistenceError(
          "No se pudo persistir la notificación y su intención Outbox.",
          error,
        );
      } finally {
        client.release();
      }
    },
  };
}
