import { randomUUID } from "node:crypto";

import type { ErrorDetail, LogicalNotification } from "./notification.types";
import { getTripNotificationContent } from "./trip-notification-content";
import { validateNormalizedTripNotificationEvent } from "./normalized-trip-notification-event.validator";

export type HandleTripNotificationEventResult =
  | { valid: true; data: LogicalNotification }
  | { valid: false; details: ErrorDetail[] };

export function handleTripNotificationEvent(
  value: unknown,
): HandleTripNotificationEventResult {
  const validation = validateNormalizedTripNotificationEvent(value);

  if (!validation.valid) {
    return validation;
  }

  const { messageId, eventType, tripId, recipientId, correlationId, occurredAt } = validation.data;
  const { title, message } = getTripNotificationContent(eventType);

  return {
    valid: true,
    data: {
      notificationId: randomUUID(),
      sourceMessageId: messageId,
      tripId,
      recipientId,
      eventType,
      title,
      message,
      correlationId,
      occurredAt,
      createdAt: new Date().toISOString(),
    },
  };
}
