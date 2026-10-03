import type { ErrorDetail, LogicalNotification } from "./notification.types";
import type { NotificationRepository } from "./notification.repository";
import type { NotificationOutboxIntent, NotificationWithOutboxRepository } from "./notification-outbox.repository";
import { handleTripNotificationEvent } from "./trip-notification.handler";

export type ProcessNormalizedTripNotificationEventResult =
  | { valid: true; data: LogicalNotification; created: boolean; outbox?: NotificationOutboxIntent }
  | { valid: false; details: ErrorDetail[] };

function supportsOutbox(
  repository: NotificationRepository | NotificationWithOutboxRepository,
): repository is NotificationWithOutboxRepository {
  return "saveWithOutbox" in repository;
}

export async function processNormalizedTripNotificationEvent(
  value: unknown,
  repository: NotificationRepository | NotificationWithOutboxRepository,
): Promise<ProcessNormalizedTripNotificationEventResult> {
  const notificationResult = handleTripNotificationEvent(value);

  if (!notificationResult.valid) {
    return notificationResult;
  }

  if (supportsOutbox(repository)) {
    const saved = await repository.saveWithOutbox(notificationResult.data);
    return {
      valid: true,
      data: saved.notification,
      created: saved.created,
      outbox: saved.outbox,
    };
  }

  const saved = await repository.saveIdempotent(notificationResult.data);
  return { valid: true, data: saved.notification, created: saved.created };
}
