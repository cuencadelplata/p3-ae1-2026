import type { ErrorDetail, LogicalNotification } from "./notification.types";
import type { NotificationRepository } from "./notification.repository";
import { handleTripNotificationEvent } from "./trip-notification.handler";

export type ProcessNormalizedTripNotificationEventResult =
  | { valid: true; data: LogicalNotification; created: boolean }
  | { valid: false; details: ErrorDetail[] };

export async function processNormalizedTripNotificationEvent(
  value: unknown,
  repository: NotificationRepository,
): Promise<ProcessNormalizedTripNotificationEventResult> {
  const notificationResult = handleTripNotificationEvent(value);

  if (!notificationResult.valid) {
    return notificationResult;
  }

  const saved = await repository.saveIdempotent(notificationResult.data);
  return { valid: true, data: saved.notification, created: saved.created };
}
