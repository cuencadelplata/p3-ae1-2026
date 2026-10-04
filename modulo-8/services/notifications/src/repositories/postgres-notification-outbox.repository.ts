import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";
import {
  M8_PRODUCER,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_ROUTING_KEY,
  NOTIFICATION_REQUESTED_VERSION,
  type NotificationDeliveryIntent,
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

interface NotificationDeliveryIntentRow {
  outbox_message_id: string;
  notification_id: string;
  recipient_id: string;
  trip_id: string;
  source_message_id: string;
  notification_event_type: LogicalNotification["eventType"];
  title: string;
  message: string;
  correlation_id: string;
  notification_created_at: Date;
  outbox_created_at: Date;
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

function mapDeliveryIntentRow(row: NotificationDeliveryIntentRow): NotificationDeliveryIntent {
  return {
    outboxMessageId: row.outbox_message_id,
    notificationId: row.notification_id,
    recipientId: row.recipient_id,
    tripId: row.trip_id,
    sourceMessageId: row.source_message_id,
    notificationEventType: row.notification_event_type,
    title: row.title,
    message: row.message,
    correlationId: row.correlation_id,
    notificationCreatedAt: row.notification_created_at.toISOString(),
    outboxCreatedAt: row.outbox_created_at.toISOString(),
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

function validatePendingLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new NotificationPersistenceError("El limite de lectura de Outbox debe estar entre 1 y 100.");
  }
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
    async findPending(limit: number): Promise<NotificationDeliveryIntent[]> {
      validatePendingLimit(limit);

      try {
        const result = await pool.query<NotificationDeliveryIntentRow>(
          `SELECT o.message_id AS outbox_message_id,
                  n.notification_id,
                  n.recipient_id,
                  n.trip_id,
                  n.source_message_id,
                  n.event_type AS notification_event_type,
                  n.title,
                  n.message,
                  n.correlation_id,
                  n.created_at AS notification_created_at,
                  o.created_at AS outbox_created_at
             FROM notifications.outbox_events o
             JOIN notifications.notifications n ON n.notification_id = o.notification_id
            WHERE o.published_at IS NULL
            ORDER BY o.created_at ASC, o.message_id ASC
            LIMIT $1`,
          [limit],
        );

        return result.rows.map(mapDeliveryIntentRow);
      } catch (error) {
        if (error instanceof NotificationPersistenceError) {
          throw error;
        }
        throw new NotificationPersistenceError("No se pudieron leer intenciones Outbox pendientes.", error);
      }
    },
    async markPublished(messageId: string, publishedAt: string): Promise<boolean> {
      try {
        const result = await pool.query<{ message_id: string }>(
          `UPDATE notifications.outbox_events
              SET published_at = COALESCE(published_at, $2)
            WHERE message_id = $1
            RETURNING message_id`,
          [messageId, publishedAt],
        );

        return result.rowCount === 1;
      } catch (error) {
        throw new NotificationPersistenceError("No se pudo marcar la intencion Outbox como publicada.", error);
      }
    },
  };
}
