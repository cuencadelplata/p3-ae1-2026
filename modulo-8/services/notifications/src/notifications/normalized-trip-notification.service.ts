import type { ErrorDetail, LogicalNotification } from "./notification.types";
import type { NotificationRepository } from "./notification.repository";
import type { NotificationOutboxIntent, NotificationWithOutboxRepository } from "./notification-outbox.repository";
import { NotificationPersistenceError } from "./notification-persistence.error";
import { handleDriverDocumentRegisteredEvent } from "./driver-document-registered-notification.handler";
import { handleTripNotificationEvent } from "./trip-notification.handler";
import type { PoolClient } from "pg";

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

export type ProcessDriverDocumentRegisteredEventResult = ProcessNormalizedTripNotificationEventResult;

type LogicalNotificationHandler = (value: unknown) =>
  | { valid: true; data: LogicalNotification }
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
  return processNotificationEvent(value, repository, handleTripNotificationEvent);
}

export async function processDriverDocumentRegisteredEvent(
  value: unknown,
  repository: NotificationRepository | NotificationWithOutboxRepository,
): Promise<ProcessDriverDocumentRegisteredEventResult> {
  return processNotificationEvent(value, repository, handleDriverDocumentRegisteredEvent);
}

async function processNotificationEvent(
  value: unknown,
  repository: NotificationRepository | NotificationWithOutboxRepository,
  handler: LogicalNotificationHandler,
): Promise<ProcessNormalizedTripNotificationEventResult> {
  const notificationResult = handler(value);

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

export async function processNormalizedTripNotificationEventWithClient(
  client: PoolClient,
  value: unknown,
  repository: NotificationWithOutboxRepository,
): Promise<ProcessNormalizedTripNotificationEventResult> {
  return processNotificationEventWithClient(client, value, repository, handleTripNotificationEvent);
}

export async function processDriverDocumentRegisteredEventWithClient(
  client: PoolClient,
  value: unknown,
  repository: NotificationWithOutboxRepository,
): Promise<ProcessDriverDocumentRegisteredEventResult> {
  return processNotificationEventWithClient(client, value, repository, handleDriverDocumentRegisteredEvent);
}

async function processNotificationEventWithClient(
  client: PoolClient,
  value: unknown,
  repository: NotificationWithOutboxRepository,
  handler: LogicalNotificationHandler,
): Promise<ProcessNormalizedTripNotificationEventResult> {
  const notificationResult = handler(value);

  if (!notificationResult.valid) {
    return { status: "INVALID_EVENT", valid: false, details: notificationResult.details };
  }

  try {
    const saved = await repository.saveWithOutboxUsingClient(client, notificationResult.data);
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
