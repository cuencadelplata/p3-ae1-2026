import {
  TRIP_NOTIFICATION_EVENT_TYPES,
  type ErrorDetail,
  type NormalizedTripNotificationEvent,
  type TripNotificationEventType,
} from "./notification.types";

const normalizedEventProperties = [
  "messageId",
  "eventType",
  "tripId",
  "rideRequestId",
  "recipientId",
  "correlationId",
  "occurredAt",
] as const;

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type NormalizedTripNotificationEventValidationResult =
  | { valid: true; data: NormalizedTripNotificationEvent }
  | { valid: false; details: ErrorDetail[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTripNotificationEventType(value: string): value is TripNotificationEventType {
  return TRIP_NOTIFICATION_EVENT_TYPES.includes(value as TripNotificationEventType);
}

function isValidIsoDateTime(value: string): boolean {
  return isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateNormalizedTripNotificationEvent(
  value: unknown,
): NormalizedTripNotificationEventValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      details: [{ field: "body", reason: "Debe ser un objeto de evento." }],
    };
  }

  const details: ErrorDetail[] = [];
  let messageId: string | undefined;
  let eventType: TripNotificationEventType | undefined;
  let tripId: string | undefined;
  let rideRequestId: string | undefined;
  let recipientId: string | number | undefined;
  let correlationId: string | undefined;
  let occurredAt: string | undefined;

  for (const property of Object.keys(value)) {
    if (!normalizedEventProperties.includes(property as (typeof normalizedEventProperties)[number])) {
      details.push({ field: property, reason: "La propiedad no esta permitida." });
    }
  }

  if (typeof value.messageId !== "string" || value.messageId.length < 1) {
    details.push({ field: "messageId", reason: "Debe ser un string con longitud minima de 1." });
  } else {
    messageId = value.messageId;
  }

  if (typeof value.eventType !== "string" || !isTripNotificationEventType(value.eventType)) {
    details.push({ field: "eventType", reason: "Debe pertenecer al catalogo de eventos semanticos permitido." });
  } else {
    eventType = value.eventType;
  }

  if (eventType === "TripRequested") {
    if ("tripId" in value) {
      details.push({ field: "tripId", reason: "No corresponde para TripRequested porque todavia no existe tripId." });
    }
    if (typeof value.rideRequestId !== "string" || value.rideRequestId.length < 1) {
      details.push({ field: "rideRequestId", reason: "Debe ser un string con longitud minima de 1." });
    } else {
      rideRequestId = value.rideRequestId;
    }
    if (!Number.isInteger(value.recipientId) || (value.recipientId as number) <= 0) {
      details.push({ field: "recipientId", reason: "Debe ser el clientUserId numerico positivo." });
    } else {
      recipientId = value.recipientId as number;
    }
  } else {
    if ("rideRequestId" in value) {
      details.push({ field: "rideRequestId", reason: "La propiedad no corresponde para eventos posteriores al viaje." });
    }
    if (typeof value.tripId !== "string" || value.tripId.length < 1) {
      details.push({ field: "tripId", reason: "Debe ser un string con longitud minima de 1." });
    } else {
      tripId = value.tripId;
    }
    if (typeof value.recipientId !== "string" || value.recipientId.length < 1) {
      details.push({ field: "recipientId", reason: "Debe ser un string con longitud minima de 1." });
    } else {
      recipientId = value.recipientId;
    }
  }

  if (typeof value.correlationId !== "string" || value.correlationId.length < 1) {
    details.push({ field: "correlationId", reason: "Debe ser un string con longitud minima de 1." });
  } else {
    correlationId = value.correlationId;
  }

  if (typeof value.occurredAt !== "string" || !isValidIsoDateTime(value.occurredAt)) {
    details.push({ field: "occurredAt", reason: "Debe ser una fecha ISO 8601 valida." });
  } else {
    occurredAt = value.occurredAt;
  }

  if (eventType === "TripRequested") {
    if (rideRequestId !== undefined && correlationId !== undefined && correlationId !== rideRequestId) {
      details.push({ field: "correlationId", reason: "Debe coincidir con rideRequestId." });
    }
  } else if (tripId !== undefined && correlationId !== undefined && correlationId !== tripId) {
    details.push({ field: "correlationId", reason: "Debe coincidir con tripId." });
  }

  if (
    details.length > 0 ||
    messageId === undefined ||
    eventType === undefined ||
    recipientId === undefined ||
    correlationId === undefined ||
    occurredAt === undefined
  ) {
    return { valid: false, details };
  }

  if (eventType === "TripRequested") {
    if (rideRequestId === undefined) {
      return { valid: false, details: [{ field: "rideRequestId", reason: "Debe ser un string con longitud minima de 1." }] };
    }
    return {
      valid: true,
      data: { messageId, eventType, rideRequestId, recipientId: recipientId as number, correlationId, occurredAt },
    };
  }

  if (tripId === undefined) {
    return { valid: false, details: [{ field: "tripId", reason: "Debe ser un string con longitud minima de 1." }] };
  }

  return {
    valid: true,
    data: { messageId, eventType, tripId, recipientId: recipientId as string, correlationId, occurredAt },
  };
}
