import { describe, expect, it, vi } from "vitest";

import { processNotification } from "../../../src/notifications/notification.service";
import type {
  EventType,
  NotificationRequest,
} from "../../../src/notifications/notification.types";
import type { PushNotificationPayload, PushProvider } from "../../../src/notifications/push-provider";

const baseRequest: NotificationRequest = {
  tripId: "trip-123",
  recipientId: "user-456",
  eventType: "DRIVER_ASSIGNED",
  channels: ["PUSH"],
};

const messages: Array<[EventType, string]> = [
  ["TRIP_REQUESTED", "Tu solicitud de viaje fue recibida."],
  ["DRIVER_ASSIGNED", "Se asignó un conductor a tu viaje."],
  ["DRIVER_ARRIVED", "Tu conductor ha llegado al punto de encuentro."],
  ["TRIP_STARTED", "Tu viaje ha comenzado."],
  ["TRIP_CANCELLED", "Tu viaje fue cancelado."],
  ["TRIP_COMPLETED", "Tu viaje ha finalizado."],
];

describe("processNotification", () => {
  it("processes a notification after the provider succeeds", async () => {
    const send = vi.fn(async (_payload: PushNotificationPayload): Promise<void> => {});
    const pushProvider: PushProvider = {
      send,
    };

    const notification = await processNotification(baseRequest, pushProvider);

    expect(notification).toMatchObject({
      tripId: baseRequest.tripId,
      recipientId: baseRequest.recipientId,
      eventType: baseRequest.eventType,
      channels: baseRequest.channels,
      message: "Se asignó un conductor a tu viaje.",
      status: "PROCESSED",
    });
    expect(notification.notificationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(notification.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(notification.createdAt))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      recipientId: baseRequest.recipientId,
      message: "Se asignó un conductor a tu viaje.",
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it.each(messages)("generates the expected message for %s", async (eventType, message) => {
    const pushProvider: PushProvider = { async send() {} };

    const notification = await processNotification({ ...baseRequest, eventType }, pushProvider);

    expect(notification.message).toBe(message);
  });

  it("propagates a provider failure without returning a processed notification", async () => {
    const failure = new Error("push provider failure");
    const pushProvider: PushProvider = {
      async send() {
        throw failure;
      },
    };

    await expect(processNotification(baseRequest, pushProvider)).rejects.toBe(failure);
  });

  it("resolves only after the provider completes", async () => {
    let release: (() => void) | undefined;
    const pushProvider: PushProvider = { send: () => new Promise<void>((resolve) => { release = resolve; }) };
    let resolved = false;
    const result = processNotification(baseRequest, pushProvider).then((notification) => { resolved = true; return notification; });

    await Promise.resolve();
    expect(resolved).toBe(false);
    release?.();
    await expect(result).resolves.toMatchObject({ status: "PROCESSED" });
  });
});
