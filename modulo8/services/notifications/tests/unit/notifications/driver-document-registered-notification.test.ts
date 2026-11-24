import { describe, expect, it, vi } from "vitest";

import { handleDriverDocumentRegisteredEvent } from "../../../src/notifications/driver-document-registered-notification.handler";
import { processDriverDocumentRegisteredEvent } from "../../../src/notifications/normalized-trip-notification.service";
import { createNotificationRequestedData } from "../../../src/notifications/notification-requested.mapper";
import type {
  NotificationOutboxIntent,
  NotificationWithOutboxRepository,
} from "../../../src/notifications/notification-outbox.repository";
import type { LogicalNotification } from "../../../src/notifications/notification.types";

const event = {
  messageId: "m3-document-message-123",
  eventType: "DriverDocumentRegistered",
  documentId: "document-123",
  driverId: 42,
  tipoDocumento: "LICENCIA",
  correlationId: "document-123",
  occurredAt: "2026-10-13T15:30:00.000Z",
};

function outboxFor(notification: LogicalNotification): NotificationOutboxIntent {
  return {
    messageId: "2b1d39b8-879d-4f57-99f2-071555555555",
    notificationId: notification.notificationId,
    eventType: "NotificationRequested",
    routingKey: "notification.requested",
    correlationId: notification.correlationId,
    version: 1,
    producer: "m8-notifications",
    payload: createNotificationRequestedData(notification),
    createdAt: notification.createdAt,
    publishedAt: null,
  };
}

function repositoryWith(
  saveWithOutbox: NotificationWithOutboxRepository["saveWithOutbox"],
): NotificationWithOutboxRepository {
  return {
    saveWithOutbox,
    saveWithOutboxUsingClient: vi.fn(),
    findPending: vi.fn(),
    claimPendingForPublish: vi.fn(),
    markPublished: vi.fn(),
    markPublishedWithClient: vi.fn(),
  };
}

describe("RF8.1 AE2 - DriverDocumentRegistered", () => {
  it("genera una notificación lógica para el conductor indicado", () => {
    const result = handleDriverDocumentRegisteredEvent(event);

    expect(result).toMatchObject({
      valid: true,
      data: {
        sourceMessageId: event.messageId,
        recipientId: 42,
        eventType: "DriverDocumentRegistered",
        tripId: null,
        rideRequestId: null,
        correlationId: event.documentId,
        title: "Documento registrado",
        message: "Tu documento fue registrado correctamente.",
      },
    });
  });

  it("prepara una solicitud interna de entrega sin exponer el documento", () => {
    const result = handleDriverDocumentRegisteredEvent(event);
    if (!result.valid) {
      throw new Error("No se generó la notificación de prueba.");
    }

    expect(createNotificationRequestedData(result.data)).toEqual({
      notificationId: result.data.notificationId,
      recipientId: 42,
      eventType: "DRIVER_DOCUMENT_REGISTERED",
      channel: "PUSH",
      message: "Tu documento fue registrado correctamente.",
      createdAt: result.data.createdAt,
    });
  });

  it("no persiste un evento incompleto", async () => {
    const saveWithOutbox = vi.fn();
    const result = await processDriverDocumentRegisteredEvent(
      { ...event, tipoDocumento: "" },
      repositoryWith(saveWithOutbox),
    );

    expect(result).toMatchObject({ status: "INVALID_EVENT", valid: false });
    expect(saveWithOutbox).not.toHaveBeenCalled();
  });

  it("rechaza un driverId que no sea el userId numérico de M1", () => {
    const result = handleDriverDocumentRegisteredEvent({ ...event, driverId: "driver-uuid" });

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "driverId" }));
    }
  });

  it("mantiene la idempotencia de negocio ante el mismo messageId", async () => {
    let persisted: LogicalNotification | undefined;
    const saveWithOutbox = vi.fn(async (notification: LogicalNotification) => {
      if (persisted !== undefined) {
        return { notification: persisted, created: false, outbox: outboxFor(persisted) };
      }
      persisted = notification;
      return { notification, created: true, outbox: outboxFor(notification) };
    });
    const repository = repositoryWith(saveWithOutbox);

    const first = await processDriverDocumentRegisteredEvent(event, repository);
    const repeated = await processDriverDocumentRegisteredEvent(event, repository);

    expect(first).toMatchObject({ status: "SUCCESS_CREATED", valid: true, created: true });
    expect(repeated).toMatchObject({ status: "SUCCESS_ALREADY_PROCESSED", valid: true, created: false });
    expect(saveWithOutbox).toHaveBeenCalledTimes(2);
    if (first.valid && repeated.valid) {
      expect(repeated.data.notificationId).toBe(first.data.notificationId);
      expect(repeated.outbox?.messageId).toBe(first.outbox?.messageId);
    }
  });
});
