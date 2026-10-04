import type { ErrorDetail, LogicalNotification } from "./notification.types";
import type { NotificationRepository } from "./notification.repository";
import type { NotificationOutboxIntent, NotificationWithOutboxRepository } from "./notification-outbox.repository";
import { NotificationPersistenceError } from "./notification-persistence.error";
import { handleTripNotificationEvent } from "./trip-notification.handler";

export type ProcessNormalizedTripNotificationEventResult =
  | {
      status: "SUCCESS_CREATED";
      valid: true;
      data: LogicalNotification;
      created: true;
      outbox?: NotificationOutboxIntent;
    }
  | {
      status: "SUCCESS_ALREADY_PROCESSED";
      valid: true;
      data: LogicalNotification;
      created: false;
      outbox?: NotificationOutboxIntent;
    }
  | {
      status: "INVALID_EVENT";
      valid: false;
      details: ErrorDetail[];
    }
  | {
      status: "PERSISTENCE_FAILURE";
      valid: false;
      error: NotificationPersistenceError;
    };

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
    return { status: "INVALID_EVENT", valid: false, details: notificationResult.details };
  }

  try {
    if (supportsOutbox(repository)) {
      const saved = await repository.saveWithOutbox(notificationResult.data);
      if (saved.created) {
        return {
          status: "SUCCESS_CREATED",
          valid: true,
          data: saved.notification,
          created: true,
          outbox: saved.outbox,
        };
      }
      return {
        status: "SUCCESS_ALREADY_PROCESSED",
        valid: true,
        data: saved.notification,
        created: false,
        outbox: saved.outbox,
      };
    }

    const saved = await repository.saveIdempotent(notificationResult.data);
    if (saved.created) {
      return {
        status: "SUCCESS_CREATED",
        valid: true,
        data: saved.notification,
        created: true,
      };
    }
    return {
      status: "SUCCESS_ALREADY_PROCESSED",
      valid: true,
      data: saved.notification,
      created: false,
    };
  } catch (error) {
    if (error instanceof NotificationPersistenceError) {
      return { status: "PERSISTENCE_FAILURE", valid: false, error };
    }
    return {
      status: "PERSISTENCE_FAILURE",
      valid: false,
      error: new NotificationPersistenceError("No se pudo procesar la notificacion normalizada.", error),
    };
  }
}
