import {
  TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE,
  type LogicalNotification,
  type NotificationRequestedData,
  type NotificationRequestedEnvelope,
} from "./notification.types";
import {
  M8_PRODUCER,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_VERSION,
  type NotificationOutboxIntent,
} from "./notification-outbox.repository";

export function toPublicNotificationEventType(
  eventType: LogicalNotification["eventType"],
): NotificationRequestedData["eventType"] {
  if (eventType === "DriverDocumentRegistered") {
    return "DRIVER_DOCUMENT_REGISTERED";
  }
  return TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE[eventType];
}

export function createNotificationRequestedData(
  notification: LogicalNotification,
): NotificationRequestedData {
  // PostgreSQL conserva recipient_id como texto por compatibilidad histórica.
  // Sólo se acepta la representación decimal canónica del userId de M1.
  const recipientId = typeof notification.recipientId === "number"
    ? notification.recipientId
    : /^[1-9]\d*$/.test(notification.recipientId)
      ? Number(notification.recipientId)
      : NaN;
  if (!Number.isSafeInteger(recipientId) || recipientId < 1) {
    throw new Error("recipientId debe ser el userId numérico positivo de M1.");
  }

  const data: NotificationRequestedData = {
    notificationId: notification.notificationId,
    recipientId,
    eventType: toPublicNotificationEventType(notification.eventType),
    channel: "PUSH",
    message: notification.message,
    createdAt: notification.createdAt,
  };

  if (notification.tripId !== null) {
    data.tripId = notification.tripId;
  }
  if (notification.rideRequestId !== null) {
    data.rideRequestId = notification.rideRequestId;
  }
  if (notification.eventType === "TripAssigned" && notification.title.trim()) {
    data.title = notification.title;
  }

  return data;
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
