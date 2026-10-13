import { randomUUID } from "node:crypto";

import type {
  DriverDocumentRegisteredNotificationEvent,
  ErrorDetail,
  LogicalNotification,
} from "./notification.types";

const allowedProperties = [
  "messageId",
  "eventType",
  "documentId",
  "driverId",
  "tipoDocumento",
  "correlationId",
  "occurredAt",
] as const;

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type HandleDriverDocumentRegisteredEventResult =
  | { valid: true; data: LogicalNotification }
  | { valid: false; details: ErrorDetail[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDateTime(value: string): boolean {
  return isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value));
}

function validateDriverDocumentRegisteredEvent(
  value: unknown,
): { valid: true; data: DriverDocumentRegisteredNotificationEvent } | { valid: false; details: ErrorDetail[] } {
  if (!isRecord(value)) {
    return { valid: false, details: [{ field: "body", reason: "Debe ser un objeto de evento." }] };
  }

  const details: ErrorDetail[] = [];
  for (const property of Object.keys(value)) {
    if (!allowedProperties.includes(property as (typeof allowedProperties)[number])) {
      details.push({ field: property, reason: "La propiedad no esta permitida." });
    }
  }

  const messageId = typeof value.messageId === "string" && value.messageId.length > 0 ? value.messageId : undefined;
  if (messageId === undefined) {
    details.push({ field: "messageId", reason: "Debe ser un string con longitud minima de 1." });
  }

  if (value.eventType !== "DriverDocumentRegistered") {
    details.push({ field: "eventType", reason: "Debe ser DriverDocumentRegistered." });
  }

  const documentId = typeof value.documentId === "string" && value.documentId.length > 0 ? value.documentId : undefined;
  if (documentId === undefined) {
    details.push({ field: "documentId", reason: "Debe ser un string con longitud minima de 1." });
  }

  const driverId = Number.isInteger(value.driverId) && (value.driverId as number) > 0 ? value.driverId as number : undefined;
  if (driverId === undefined) {
    details.push({ field: "driverId", reason: "Debe ser el userId numerico positivo canonico de M1." });
  }

  const tipoDocumento = typeof value.tipoDocumento === "string" && value.tipoDocumento.length > 0 ? value.tipoDocumento : undefined;
  if (tipoDocumento === undefined) {
    details.push({ field: "tipoDocumento", reason: "Debe ser un string con longitud minima de 1." });
  }

  const correlationId = typeof value.correlationId === "string" && value.correlationId.length > 0 ? value.correlationId : undefined;
  if (correlationId === undefined) {
    details.push({ field: "correlationId", reason: "Debe ser un string con longitud minima de 1." });
  } else if (documentId !== undefined && correlationId !== documentId) {
    details.push({ field: "correlationId", reason: "Debe coincidir con documentId." });
  }

  const occurredAt = typeof value.occurredAt === "string" && isValidIsoDateTime(value.occurredAt) ? value.occurredAt : undefined;
  if (occurredAt === undefined) {
    details.push({ field: "occurredAt", reason: "Debe ser una fecha ISO 8601 valida." });
  }

  if (
    details.length > 0 ||
    messageId === undefined ||
    documentId === undefined ||
    driverId === undefined ||
    tipoDocumento === undefined ||
    correlationId === undefined ||
    occurredAt === undefined
  ) {
    return { valid: false, details };
  }

  return {
    valid: true,
    data: {
      messageId,
      eventType: "DriverDocumentRegistered",
      documentId,
      driverId,
      tipoDocumento,
      correlationId,
      occurredAt,
    },
  };
}

export function handleDriverDocumentRegisteredEvent(
  value: unknown,
): HandleDriverDocumentRegisteredEventResult {
  const validation = validateDriverDocumentRegisteredEvent(value);
  if (!validation.valid) {
    return validation;
  }

  const { messageId, driverId, correlationId, occurredAt } = validation.data;
  return {
    valid: true,
    data: {
      notificationId: randomUUID(),
      sourceMessageId: messageId,
      tripId: null,
      rideRequestId: null,
      recipientId: driverId,
      eventType: "DriverDocumentRegistered",
      title: "Documento registrado",
      message: "Tu documento fue registrado correctamente.",
      correlationId,
      occurredAt,
      createdAt: new Date().toISOString(),
    },
  };
}
