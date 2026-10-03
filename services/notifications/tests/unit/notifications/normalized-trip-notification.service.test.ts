import { describe, expect, it, vi } from "vitest";

import { NotificationPersistenceError } from "../../../src/notifications/notification-persistence.error";
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
});
