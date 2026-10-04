import {
  TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE,
  type LogicalNotification,
  type NotificationRequestedData,
  type NotificationRequestedEnvelope,
  type TripNotificationEventType,
} from "./notification.types";
import {
  M8_PRODUCER,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_VERSION,
  type NotificationOutboxIntent,
} from "./notification-outbox.repository";

export function toPublicNotificationEventType(
  eventType: TripNotificationEventType,
): NotificationRequestedData["eventType"] {
  return TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE[eventType];
}

export function createNotificationRequestedData(
  notification: LogicalNotification,
): NotificationRequestedData {
  return {
    notificationId: notification.notificationId,
    tripId: notification.tripId,
    recipientId: notification.recipientId,
    eventType: toPublicNotificationEventType(notification.eventType),
    channel: "PUSH",
    message: notification.message,
    createdAt: notification.createdAt,
  };
}

export function createNotificationRequestedEnvelope(
  outbox: NotificationOutboxIntent,
): NotificationRequestedEnvelope {
  return {
    messageId: outbox.messageId,
    eventType: NOTIFICATION_REQUESTED_EVENT_TYPE,
    version: NOTIFICATION_REQUESTED_VERSION,
    occurredAt: outbox.createdAt,
    correlationId: outbox.correlationId,
    producer: M8_PRODUCER,
    data: outbox.payload,
  };
}
