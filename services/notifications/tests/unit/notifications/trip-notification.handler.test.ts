import { describe, expect, it } from "vitest";

import { validateNormalizedTripNotificationEvent } from "../../../src/notifications/normalized-trip-notification-event.validator";
import {
  createNotificationRequestedData,
  createNotificationRequestedEnvelope,
} from "../../../src/notifications/notification-requested.mapper";
import {
  HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE,
  TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE,
  type TripNotificationEventType,
} from "../../../src/notifications/notification.types";
import { handleTripNotificationEvent } from "../../../src/notifications/trip-notification.handler";
import { mapTripEventEnvelope } from "../../../src/notifications/trip-event-envelope.mapper";

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

const amqpEvents: Array<[string, TripNotificationEventType]> = [
  ["TripRequested", "TripRequested"],
  ["DriverAssigned", "TripAssigned"],
  ["DriverArrived", "DriverArrived"],
  ["TripStarted", "TripStarted"],
  ["TripCancelled", "TripCancelled"],
  ["TripCompleted", "TripCompleted"],
];

describe("RF8.1 AE2 - evento normalizado de notificacion", () => {
  it("traduce explicitamente los enums HTTP AE1 a eventos semanticos AE2", () => {
    expect(HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE).toEqual({
      TRIP_REQUESTED: "TripRequested",
      DRIVER_ASSIGNED: "TripAssigned",
      DRIVER_ARRIVED: "DriverArrived",
      TRIP_STARTED: "TripStarted",
      TRIP_CANCELLED: "TripCancelled",
      TRIP_COMPLETED: "TripCompleted",
    });
  });

  it("mantiene una unica fuente de verdad para eventos internos a payload publico", () => {
    expect(TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE).toEqual({
      TripRequested: "TRIP_REQUESTED",
      TripAssigned: "DRIVER_ASSIGNED",
      DriverArrived: "DRIVER_ARRIVED",
      TripStarted: "TRIP_STARTED",
      TripCancelled: "TRIP_CANCELLED",
      TripCompleted: "TRIP_COMPLETED",
    });
  });

  it("acepta un evento normalizado valido", () => {
    expect(validateNormalizedTripNotificationEvent(validEvent)).toEqual({
      valid: true,
      data: validEvent,
    });
  });

  it.each(expectedContent)("acepta el evento semantico %s", (eventType) => {
    expect(validateNormalizedTripNotificationEvent({ ...validEvent, eventType })).toMatchObject({
      valid: true,
    });
  });

  it.each([
    ["messageId faltante", { ...validEvent, messageId: undefined }, "messageId"],
    ["messageId vacio", { ...validEvent, messageId: "" }, "messageId"],
    ["tripId vacio", { ...validEvent, tripId: "" }, "tripId"],
    ["recipientId vacio", { ...validEvent, recipientId: "" }, "recipientId"],
    ["correlationId vacio", { ...validEvent, correlationId: "" }, "correlationId"],
    ["correlationId distinto", { ...validEvent, correlationId: "another-trip" }, "correlationId"],
    ["occurredAt invalido", { ...validEvent, occurredAt: "not-a-date" }, "occurredAt"],
    ["occurredAt sin hora ISO", { ...validEvent, occurredAt: "2026-10-03" }, "occurredAt"],
    ["eventType desconocido", { ...validEvent, eventType: "TripDelayed" }, "eventType"],
  ])("rechaza %s", (_description, event, field) => {
    const result = validateNormalizedTripNotificationEvent(event);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it.each([null, [], "event"])("rechaza una estructura invalida: %j", (event) => {
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

describe("RF8.1 AE2 - TripEventEnvelope RF8.6 a RF8.1", () => {
  const envelope = {
    messageId: "9f1c7b2e-4d3a-4c8f-9b21-6e0a5c7d4812",
    eventType: "DriverAssigned",
    version: 1,
    occurredAt: "2026-10-05T18:42:11.000Z",
    correlationId: "trip-2026-000123",
    producer: "m6-viajes",
    data: {
      tripId: "trip-2026-000123",
      recipientId: "usr-0091",
      details: { ignored: true },
    },
  };

  it.each(amqpEvents)("mapea %s al evento interno %s", (eventType, expectedInternalEvent) => {
    expect(mapTripEventEnvelope({ ...envelope, eventType })).toEqual({
      valid: true,
      data: {
        messageId: envelope.messageId,
        eventType: expectedInternalEvent,
        tripId: envelope.data.tripId,
        recipientId: envelope.data.recipientId,
        correlationId: envelope.correlationId,
        occurredAt: envelope.occurredAt,
      },
    });
  });

  it.each([
    ["version distinta", { ...envelope, version: 2 }, "version"],
    ["correlationId distinto", { ...envelope, correlationId: "trip-other" }, "correlationId"],
    ["tripId faltante", { ...envelope, data: { ...envelope.data, tripId: "" } }, "data.tripId"],
    ["recipientId faltante", { ...envelope, data: { ...envelope.data, recipientId: "" } }, "data.recipientId"],
    ["occurredAt invalido", { ...envelope, occurredAt: "invalid-date" }, "occurredAt"],
    ["eventType desconocido", { ...envelope, eventType: "TripDelayed" }, "eventType"],
    ["producer vacio", { ...envelope, producer: "" }, "producer"],
  ])("rechaza %s", (_description, input, field) => {
    const result = mapTripEventEnvelope(input);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it.each([null, [], "event", { ...envelope, data: null }])("rechaza estructura invalida: %j", (input) => {
    expect(mapTripEventEnvelope(input)).toMatchObject({ valid: false });
  });
});

describe("RF8.1 AE2 - handleTripNotificationEvent", () => {
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

  it("mantiene title y message deterministicos para el mismo eventType", () => {
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

  it("devuelve los detalles de validacion y no genera una notificacion invalida", () => {
    const result = handleTripNotificationEvent({ ...validEvent, correlationId: "wrong-trip" });

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "correlationId" }));
    }
  });
});

describe("RF8.1 AE2 - NotificationRequested", () => {
  it.each(expectedContent)("genera payload contractual para %s", (eventType, _title, message) => {
    const notification = handleTripNotificationEvent({ ...validEvent, eventType });

    expect(notification).toMatchObject({ valid: true });
    if (!notification.valid) {
      throw new Error("No se genero la notificacion de prueba.");
    }

    expect(createNotificationRequestedData(notification.data)).toEqual({
      notificationId: notification.data.notificationId,
      tripId: notification.data.tripId,
      recipientId: notification.data.recipientId,
      eventType: TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE[eventType],
      channel: "PUSH",
      message,
      createdAt: notification.data.createdAt,
    });
  });

  it("genera envelope contractual sin campos extra", () => {
    const notification = handleTripNotificationEvent(validEvent);
    if (!notification.valid) {
      throw new Error("No se genero la notificacion de prueba.");
    }
    const payload = createNotificationRequestedData(notification.data);

    expect(
      createNotificationRequestedEnvelope({
        messageId: "7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a",
        notificationId: notification.data.notificationId,
        eventType: "NotificationRequested",
        routingKey: "notification.requested",
        correlationId: notification.data.correlationId,
        version: 1,
        producer: "m8-notifications",
        payload,
        createdAt: "2026-10-05T18:42:12.500Z",
        publishedAt: null,
      }),
    ).toEqual({
      messageId: "7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a",
      eventType: "NotificationRequested",
      version: 1,
      occurredAt: "2026-10-05T18:42:12.500Z",
      correlationId: notification.data.correlationId,
      producer: "m8-notifications",
      data: payload,
    });
  });
});
