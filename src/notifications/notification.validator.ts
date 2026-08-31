import {
  EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  type ErrorDetail,
  type EventType,
  type NotificationChannel,
  type NotificationRequest,
} from "./notification.types";

const notificationRequestProperties = [
  "tripId",
  "recipientId",
  "eventType",
  "channels",
] as const;

export type NotificationRequestValidationResult =
  | { valid: true; data: NotificationRequest }
  | { valid: false; details: ErrorDetail[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventType(value: string): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}

function isNotificationChannel(value: string): value is NotificationChannel {
  return NOTIFICATION_CHANNELS.includes(value as NotificationChannel);
}

export function validateNotificationRequest(
  value: unknown,
): NotificationRequestValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      details: [{ field: "body", reason: "Debe ser un objeto JSON." }],
    };
  }

  const details: ErrorDetail[] = [];
  let tripId: string | undefined;
  let recipientId: string | undefined;
  let eventType: EventType | undefined;
  let channels: NotificationChannel[] | undefined;

  for (const property of Object.keys(value)) {
    if (
      !notificationRequestProperties.includes(
        property as (typeof notificationRequestProperties)[number],
      )
    ) {
      details.push({
        field: property,
        reason: "La propiedad no está permitida.",
      });
    }
  }

  if (typeof value.tripId !== "string" || value.tripId.length < 1) {
    details.push({
      field: "tripId",
      reason: "Debe ser un string con longitud mínima de 1.",
    });
  } else {
    tripId = value.tripId;
  }

  if (typeof value.recipientId !== "string" || value.recipientId.length < 1) {
    details.push({
      field: "recipientId",
      reason: "Debe ser un string con longitud mínima de 1.",
    });
  } else {
    recipientId = value.recipientId;
  }

  if (typeof value.eventType !== "string" || !isEventType(value.eventType)) {
    details.push({
      field: "eventType",
      reason: "Debe pertenecer al catálogo de eventos permitido.",
    });
  } else {
    eventType = value.eventType;
  }

  if (!Array.isArray(value.channels)) {
    details.push({ field: "channels", reason: "Debe ser un array." });
  } else {
    const validChannels: NotificationChannel[] = [];

    if (value.channels.length < 1) {
      details.push({ field: "channels", reason: "Debe contener al menos un elemento." });
    }

    if (new Set(value.channels).size !== value.channels.length) {
      details.push({ field: "channels", reason: "No puede contener valores repetidos." });
    }

    value.channels.forEach((channel, index) => {
      if (typeof channel === "string" && isNotificationChannel(channel)) {
        validChannels.push(channel);
      } else {
        details.push({
          field: `channels[${index}]`,
          reason: "Solo se admite PUSH en AE1.",
        });
      }
    });

    channels = validChannels;
  }

  if (
    details.length > 0 ||
    tripId === undefined ||
    recipientId === undefined ||
    eventType === undefined ||
    channels === undefined
  ) {
    return { valid: false, details };
  }

  return {
    valid: true,
    data: {
      tripId,
      recipientId,
      eventType,
      channels,
    },
  };
}
