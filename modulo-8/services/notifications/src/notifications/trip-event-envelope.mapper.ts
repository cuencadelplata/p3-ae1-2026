import {
  TRIP_EVENT_TYPE_MAP,
  type AmqpTripEventType,
  type ErrorDetail,
  type NormalizedTripNotificationEvent,
  type TripNotificationEventType,
} from "./notification.types";

const amqpToInternalEventType: Record<AmqpTripEventType, TripNotificationEventType> = {
  TripRequested: "TripRequested",
  DriverAssigned: "TripAssigned",
  DriverArrived: "DriverArrived",
  TripStarted: "TripStarted",
  TripCancelled: "TripCancelled",
  TripCompleted: "TripCompleted",
};

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TripEventEnvelopeMappingResult =
  | { valid: true; data: NormalizedTripNotificationEvent }
  | { valid: false; details: ErrorDetail[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAmqpTripEventType(value: string): value is AmqpTripEventType {
  return value in TRIP_EVENT_TYPE_MAP;
}

function isValidIsoDateTime(value: string): boolean {
  return isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value));
}

function numberField(
  source: Record<string, unknown>,
  field: string,
  details: ErrorDetail[],
  detailField = field,
): number | undefined {
  const value = source[field];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    details.push({ field: detailField, reason: "Debe ser un entero positivo." });
    return undefined;
  }
  return value as number;
}

function objectField(
  source: Record<string, unknown>,
  field: string,
  details: ErrorDetail[],
  detailField = field,
): Record<string, unknown> | undefined {
  const value = source[field];
  if (!isRecord(value)) {
    details.push({ field: detailField, reason: "Debe ser un objeto." });
    return undefined;
  }
  return value;
}

function stringField(
  source: Record<string, unknown>,
  field: string,
  details: ErrorDetail[],
  detailField = field,
): string | undefined {
  const value = source[field];
  if (typeof value !== "string" || value.length < 1) {
    details.push({ field: detailField, reason: "Debe ser un string con longitud minima de 1." });
    return undefined;
  }
  return value;
}

export function mapTripEventEnvelope(
  value: unknown,
): TripEventEnvelopeMappingResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      details: [{ field: "body", reason: "Debe ser un objeto de envelope." }],
    };
  }

  const details: ErrorDetail[] = [];
  const messageId = stringField(value, "messageId", details);
  const occurredAt = stringField(value, "occurredAt", details);
  const correlationId = stringField(value, "correlationId", details);
  const producer = stringField(value, "producer", details);

  let eventType: TripNotificationEventType | undefined;
  if (typeof value.eventType !== "string" || !isAmqpTripEventType(value.eventType)) {
    details.push({ field: "eventType", reason: "Debe pertenecer al catalogo de eventos AMQP permitido." });
  } else {
    eventType = amqpToInternalEventType[value.eventType];
  }

  if (value.version !== 1) {
    details.push({ field: "version", reason: "Debe ser 1." });
  }

  if (occurredAt !== undefined && !isValidIsoDateTime(occurredAt)) {
    details.push({ field: "occurredAt", reason: "Debe ser una fecha ISO 8601 valida." });
  }

  if (messageId !== undefined && !uuidPattern.test(messageId)) {
    details.push({ field: "messageId", reason: "Debe ser un UUID valido." });
  }

  if (eventType === "TripRequested") {
    let rideRequestId: string | undefined;
    let recipientId: number | undefined;
    if (!isRecord(value.data)) {
      details.push({ field: "data", reason: "Debe ser un objeto." });
    } else {
      rideRequestId = stringField(value.data, "rideRequestId", details, "data.rideRequestId");
      recipientId = numberField(value.data, "clientUserId", details, "data.clientUserId");
      objectField(value.data, "origin", details, "data.origin");
      objectField(value.data, "destination", details, "data.destination");
      stringField(value.data, "vehicleType", details, "data.vehicleType");
      const estimatedFare = objectField(value.data, "estimatedFare", details, "data.estimatedFare");
      if (estimatedFare !== undefined) {
        const amount = estimatedFare["amount"];
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
          details.push({ field: "data.estimatedFare.amount", reason: "Debe ser un numero mayor o igual a 0." });
        }
        stringField(estimatedFare, "currency", details, "data.estimatedFare.currency");
      }
      const createdAt = stringField(value.data, "createdAt", details, "data.createdAt");
      if (createdAt !== undefined && !isValidIsoDateTime(createdAt)) {
        details.push({ field: "data.createdAt", reason: "Debe ser una fecha ISO 8601 valida." });
      }
    }

    if (producer !== undefined && producer !== "m5") {
      details.push({ field: "producer", reason: "Debe ser m5 para ride.requested." });
    }

    if (rideRequestId !== undefined && correlationId !== undefined && correlationId !== rideRequestId) {
      details.push({ field: "correlationId", reason: "Debe coincidir con data.rideRequestId." });
    }

    if (
      details.length > 0 ||
      messageId === undefined ||
      occurredAt === undefined ||
      correlationId === undefined ||
      rideRequestId === undefined ||
      recipientId === undefined
    ) {
      return { valid: false, details };
    }

    return {
      valid: true,
      data: {
        messageId,
        eventType,
        rideRequestId,
        recipientId,
        correlationId,
        occurredAt,
      },
    };
  }

  let tripId: string | undefined;
  let recipientId: string | undefined;
  if (!isRecord(value.data)) {
    details.push({ field: "data", reason: "Debe ser un objeto." });
  } else {
    tripId = stringField(value.data, "tripId", details, "data.tripId");
    recipientId = stringField(value.data, "recipientId", details, "data.recipientId");
  }

  if (tripId !== undefined && correlationId !== undefined && correlationId !== tripId) {
    details.push({ field: "correlationId", reason: "Debe coincidir con data.tripId." });
  }

  if (
    details.length > 0 ||
    messageId === undefined ||
    eventType === undefined ||
    occurredAt === undefined ||
    correlationId === undefined ||
    tripId === undefined ||
    recipientId === undefined
  ) {
    return { valid: false, details };
  }

  return {
    valid: true,
    data: {
      messageId,
      eventType,
      tripId,
      recipientId,
      correlationId,
      occurredAt,
    },
  };
}
