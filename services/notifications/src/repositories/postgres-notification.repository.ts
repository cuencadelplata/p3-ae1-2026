import type { Pool, PoolClient } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";
import type { NotificationRepository, SaveNotificationResult } from "../notifications/notification.repository";
import type { LogicalNotification, TripNotificationEventType } from "../notifications/notification.types";

interface NotificationRow {
  notification_id: string;
  source_message_id: string;
  trip_id: string | null;
  ride_request_id: string | null;
  recipient_id: string;
  event_type: TripNotificationEventType;
  title: string;
  message: string;
  correlation_id: string;
  occurred_at: Date;
  created_at: Date;
}

export const notificationColumns = `
  notification_id, source_message_id, trip_id, ride_request_id, recipient_id, event_type,
  title, message, correlation_id, occurred_at, created_at
`;

export function mapNotificationRow(row: NotificationRow): LogicalNotification {
  return {
    notificationId: row.notification_id,
    sourceMessageId: row.source_message_id,
    tripId: row.trip_id,
    rideRequestId: row.ride_request_id,
    recipientId: row.recipient_id,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

type NotificationQueryExecutor = Pick<Pool | PoolClient, "query">;

export async function saveNotificationIdempotent(
  executor: NotificationQueryExecutor,
  notification: LogicalNotification,
): Promise<SaveNotificationResult> {
  try {
        const inserted = await executor.query<NotificationRow>(
          `INSERT INTO notifications.notifications (${notificationColumns})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (source_message_id, recipient_id) DO NOTHING
           RETURNING ${notificationColumns}`,
          [
            notification.notificationId,
            notification.sourceMessageId,
            notification.tripId,
            notification.rideRequestId,
            String(notification.recipientId),
            notification.eventType,
            notification.title,
            notification.message,
            notification.correlationId,
            notification.occurredAt,
            notification.createdAt,
          ],
        );

        if (inserted.rowCount === 1) {
          return { notification: mapNotificationRow(inserted.rows[0]), created: true };
        }

        const existing = await executor.query<NotificationRow>(
          `SELECT ${notificationColumns}
           FROM notifications.notifications
           WHERE source_message_id = $1 AND recipient_id = $2`,
          [notification.sourceMessageId, String(notification.recipientId)],
        );

        if (existing.rowCount !== 1) {
          throw new NotificationPersistenceError("No se encontró la notificación duplicada persistida.");
        }

        return { notification: mapNotificationRow(existing.rows[0]), created: false };
      } catch (error) {
        if (error instanceof NotificationPersistenceError) {
          throw error;
        }
        throw new NotificationPersistenceError("No se pudo persistir la notificación.", error);
      }
}

export function createPostgresNotificationRepository(pool: Pool): NotificationRepository {
  return {
    saveIdempotent(notification: LogicalNotification): Promise<SaveNotificationResult> {
      return saveNotificationIdempotent(pool, notification);
    },
  };
}
