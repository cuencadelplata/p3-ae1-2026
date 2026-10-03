import { describe, expect, it } from "vitest";

import { handleTripNotificationEvent } from "../../../src/notifications/trip-notification.handler";
import { validateNormalizedTripNotificationEvent } from "../../../src/notifications/normalized-trip-notification-event.validator";
import {
  HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE,
  type TripNotificationEventType,
} from "../../../src/notifications/notification.types";

const validEvent = {
  messageId: "message-123",
  eventType: "TripAssigned",
  tripId: "trip-123",
  recipientId: "user-456",
  correlationId: "trip-123",
  occurredAt: "2026-10-03T15:30:00.000Z",
};

const expectedContent: Array<[TripNotificationEventType, string, string]> = [
  ["TripRequested", "Solicitud de viaje recibida", "Tu solicitud de viaje fue recibida."],
  ["TripAssigned", "Conductor asignado", "Se asignó un conductor a tu viaje."],
  ["DriverArrived", "Tu conductor llegó", "Tu conductor ha llegado al punto de encuentro."],
  ["TripStarted", "Tu viaje comenzó", "Tu viaje ha comenzado."],
  ["TripCancelled", "Viaje cancelado", "Tu viaje fue cancelado."],
  ["TripCompleted", "Viaje finalizado", "Tu viaje ha finalizado."],
];

describe("RF8.1 AE2 — evento normalizado de notificación", () => {
  it("traduce explícitamente los enums HTTP AE1 a eventos semánticos AE2", () => {
    expect(HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE).toEqual({
      TRIP_REQUESTED: "TripRequested",
      DRIVER_ASSIGNED: "TripAssigned",
      DRIVER_ARRIVED: "DriverArrived",
      TRIP_STARTED: "TripStarted",
      TRIP_CANCELLED: "TripCancelled",
      TRIP_COMPLETED: "TripCompleted",
    });
  });

  it("acepta un evento normalizado válido", () => {
    expect(validateNormalizedTripNotificationEvent(validEvent)).toEqual({
      valid: true,
      data: validEvent,
    });
  });

  it.each(expectedContent)("acepta el evento semántico %s", (eventType) => {
    expect(validateNormalizedTripNotificationEvent({ ...validEvent, eventType })).toMatchObject({
      valid: true,
    });
  });

  it.each([
    ["messageId faltante", { ...validEvent, messageId: undefined }, "messageId"],
    ["messageId vacío", { ...validEvent, messageId: "" }, "messageId"],
    ["tripId vacío", { ...validEvent, tripId: "" }, "tripId"],
    ["recipientId vacío", { ...validEvent, recipientId: "" }, "recipientId"],
    ["correlationId vacío", { ...validEvent, correlationId: "" }, "correlationId"],
    ["correlationId distinto", { ...validEvent, correlationId: "another-trip" }, "correlationId"],
    ["occurredAt inválido", { ...validEvent, occurredAt: "not-a-date" }, "occurredAt"],
    ["occurredAt sin hora ISO", { ...validEvent, occurredAt: "2026-10-03" }, "occurredAt"],
    ["eventType desconocido", { ...validEvent, eventType: "TripDelayed" }, "eventType"],
  ])("rechaza %s", (_description, event, field) => {
    const result = validateNormalizedTripNotificationEvent(event);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it.each([null, [], "event"])("rechaza una estructura inválida: %j", (event) => {
    expect(validateNormalizedTripNotificationEvent(event)).toMatchObject({ valid: false });
  });

  it("rechaza una propiedad adicional sin modificar la entrada", () => {
    const input: Record<string, unknown> = { ...validEvent, extra: true };
    const snapshot = structuredClone(input);
    const result = validateNormalizedTripNotificationEvent(input);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "extra" }));
    }
    expect(input).toEqual(snapshot);
  });
});

describe("RF8.1 AE2 — handleTripNotificationEvent", () => {
  it.each(expectedContent)("genera title y message para %s", (eventType, title, message) => {
    const result = handleTripNotificationEvent({ ...validEvent, eventType });

    expect(result).toMatchObject({
      valid: true,
      data: {
        sourceMessageId: validEvent.messageId,
        tripId: validEvent.tripId,
        recipientId: validEvent.recipientId,
        eventType,
        title,
        message,
        correlationId: validEvent.correlationId,
      },
    });
    if (result.valid) {
      expect(result.data.notificationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  });

  it("mantiene title y message determinísticos para el mismo eventType", () => {
    const first = handleTripNotificationEvent(validEvent);
    const second = handleTripNotificationEvent({ ...validEvent, messageId: "message-456" });

    expect(first).toMatchObject({ valid: true });
    expect(second).toMatchObject({ valid: true });
    if (first.valid && second.valid) {
      expect(first.data.title).toBe(second.data.title);
      expect(first.data.message).toBe(second.data.message);
      expect(first.data.sourceMessageId).not.toBe(second.data.sourceMessageId);
    }
  });

  it("devuelve los detalles de validación y no genera una notificación inválida", () => {
    const result = handleTripNotificationEvent({ ...validEvent, correlationId: "wrong-trip" });

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "correlationId" }));
    }
  });
});
