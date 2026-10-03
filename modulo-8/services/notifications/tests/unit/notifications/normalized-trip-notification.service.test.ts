import { describe, expect, it, vi } from "vitest";

import { NotificationPersistenceError } from "../../../src/notifications/notification-persistence.error";
import {
  M8_PRODUCER,
  NOTIFICATION_REQUESTED_EVENT_TYPE,
  NOTIFICATION_REQUESTED_ROUTING_KEY,
  type NotificationWithOutboxRepository,
} from "../../../src/notifications/notification-outbox.repository";
import type { NotificationRepository } from "../../../src/notifications/notification.repository";
import { processNormalizedTripNotificationEvent } from "../../../src/notifications/normalized-trip-notification.service";
import type { LogicalNotification } from "../../../src/notifications/notification.types";

const event = {
  messageId: "message-123",
  eventType: "TripAssigned",
  tripId: "trip-123",
  recipientId: "user-456",
  correlationId: "trip-123",
  occurredAt: "2026-10-03T15:30:00.000Z",
};

function createRepository(
  saveIdempotent: NotificationRepository["saveIdempotent"],
): NotificationRepository {
  return { saveIdempotent };
}

function createOutboxRepository(
  saveWithOutbox: NotificationWithOutboxRepository["saveWithOutbox"],
): NotificationWithOutboxRepository {
  return { saveWithOutbox };
}

describe("RF8.1 AE2 — persistencia de evento normalizado", () => {
  it("persiste una notificación lógica nueva", async () => {
    const saveIdempotent = vi.fn(async (notification: LogicalNotification) => ({
      notification,
      created: true,
    }));

    const result = await processNormalizedTripNotificationEvent(event, createRepository(saveIdempotent));

    expect(result).toMatchObject({ valid: true, created: true });
    expect(saveIdempotent).toHaveBeenCalledOnce();
    if (result.valid) {
      expect(result.data).toMatchObject({
        sourceMessageId: event.messageId,
        occurredAt: event.occurredAt,
        eventType: event.eventType,
      });
    }
  });

  it("devuelve la notificación existente cuando el repositorio detecta un duplicado", async () => {
    const existing: LogicalNotification = {
      notificationId: "b5f552b3-17e2-42dd-b4f7-a15100000001",
      sourceMessageId: event.messageId,
      tripId: event.tripId,
      recipientId: event.recipientId,
      eventType: "TripAssigned",
      title: "Conductor asignado",
      message: "Se asignó un conductor a tu viaje.",
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
      createdAt: "2026-10-03T15:31:00.000Z",
    };
    const saveIdempotent = vi.fn(async () => ({ notification: existing, created: false }));

    const result = await processNormalizedTripNotificationEvent(event, createRepository(saveIdempotent));

    expect(result).toEqual({ valid: true, data: existing, created: false });
  });

  it("no persiste un evento inválido", async () => {
    const saveIdempotent = vi.fn();

    const result = await processNormalizedTripNotificationEvent(
      { ...event, correlationId: "another-trip" },
      createRepository(saveIdempotent),
    );

    expect(result).toMatchObject({ valid: false });
    expect(saveIdempotent).not.toHaveBeenCalled();
  });

  it("propaga un error clasificado de persistencia", async () => {
    const persistenceError = new NotificationPersistenceError("CommunicationsDB no disponible.");
    const saveIdempotent = vi.fn(async () => {
      throw persistenceError;
    });

    await expect(
      processNormalizedTripNotificationEvent(event, createRepository(saveIdempotent)),
    ).rejects.toBe(persistenceError);
  });

  it("usa el puerto transaccional cuando está disponible", async () => {
    const saveWithOutbox: NotificationWithOutboxRepository["saveWithOutbox"] = vi.fn(async (notification: LogicalNotification) => ({
      notification,
      created: true,
      outbox: {
        messageId: "47b9d9d8-7ca4-4dd1-b4e8-904100000001",
        notificationId: notification.notificationId,
        eventType: NOTIFICATION_REQUESTED_EVENT_TYPE as typeof NOTIFICATION_REQUESTED_EVENT_TYPE,
        routingKey: NOTIFICATION_REQUESTED_ROUTING_KEY as typeof NOTIFICATION_REQUESTED_ROUTING_KEY,
        correlationId: notification.correlationId,
        version: 1 as const,
        producer: M8_PRODUCER as typeof M8_PRODUCER,
        payload: null,
        createdAt: notification.createdAt,
        publishedAt: null,
      },
    }));

    const result = await processNormalizedTripNotificationEvent(event, createOutboxRepository(saveWithOutbox));

    expect(result).toMatchObject({ valid: true, created: true });
    expect(saveWithOutbox).toHaveBeenCalledOnce();
    if (result.valid) {
      expect(result.outbox).toMatchObject({
        eventType: "NotificationRequested",
        routingKey: "notification.requested",
        payload: null,
      });
    }
  });

  it("conserva el resultado idempotente y la misma intención Outbox", async () => {
    const notification: LogicalNotification = {
      notificationId: "b5f552b3-17e2-42dd-b4f7-a15100000002",
      sourceMessageId: event.messageId,
      tripId: event.tripId,
      recipientId: event.recipientId,
      eventType: "TripAssigned",
      title: "Conductor asignado",
      message: "Se asignó un conductor a tu viaje.",
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
      createdAt: "2026-10-03T15:31:00.000Z",
    };
    const saveWithOutbox: NotificationWithOutboxRepository["saveWithOutbox"] = vi.fn(async () => ({
      notification,
      created: false,
      outbox: {
        messageId: "47b9d9d8-7ca4-4dd1-b4e8-904100000002",
        notificationId: notification.notificationId,
        eventType: NOTIFICATION_REQUESTED_EVENT_TYPE as typeof NOTIFICATION_REQUESTED_EVENT_TYPE,
        routingKey: NOTIFICATION_REQUESTED_ROUTING_KEY as typeof NOTIFICATION_REQUESTED_ROUTING_KEY,
        correlationId: notification.correlationId,
        version: 1 as const,
        producer: M8_PRODUCER as typeof M8_PRODUCER,
        payload: null,
        createdAt: notification.createdAt,
        publishedAt: null,
      },
    }));

    const result = await processNormalizedTripNotificationEvent(event, createOutboxRepository(saveWithOutbox));

    expect(result).toMatchObject({ valid: true, data: notification, created: false });
    if (result.valid) {
      expect(result.outbox?.messageId).toBe("47b9d9d8-7ca4-4dd1-b4e8-904100000002");
    }
  });
});
