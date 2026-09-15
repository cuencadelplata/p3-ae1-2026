import { // importo las constantes y tipos de notification.types
  EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  type ErrorDetail,
  type EventType,
  type NotificationChannel,
  type NotificationRequest,
} from "./notification.types";

const notificationRequestProperties = [ // aca declaro las propiedades que puede tener la notificacion
  "tripId",
  "recipientId",
  "eventType",
  "channels",
] as const;

export type NotificationRequestValidationResult = // el resultado de la validacion
  | { valid: true; data: NotificationRequest }
  | { valid: false; details: ErrorDetail[] };

function isRecord(value: unknown): value is Record<string, unknown> {//aca declaro que es un objeto
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventType(value: string): value is EventType {//aca declaro que es un evento
  return EVENT_TYPES.includes(value as EventType);
}

function isNotificationChannel(value: string): value is NotificationChannel {//aca declaro que es un canal
  return NOTIFICATION_CHANNELS.includes(value as NotificationChannel);
}

export function validateNotificationRequest( //aca valido que la notificacion sea correcta
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

  for (const property of Object.keys(value)) {//recorro las propiedades de la notificacion
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

  if (typeof value.tripId !== "string" || value.tripId.length < 1) { //aca valido que el tripId sea un string y tenga longitud minima de 1
    details.push({
      field: "tripId",
      reason: "Debe ser un string con longitud mínima de 1.",
    });
  } else {
    tripId = value.tripId;
  }

  if (typeof value.recipientId !== "string" || value.recipientId.length < 1) {//aca valido que el recipientId sea un string y tenga longitud minima de 1
    details.push({
      field: "recipientId",
      reason: "Debe ser un string con longitud mínima de 1.",
    });
  } else {
    recipientId = value.recipientId;
  }

  if (typeof value.eventType !== "string" || !isEventType(value.eventType)) {//aca valido que el eventType sea un string y pertenezca al catalogo de eventos permitido
    details.push({
      field: "eventType",
      reason: "Debe pertenecer al catálogo de eventos permitido.",
    });
  } else {
    eventType = value.eventType;
  }

  if (!Array.isArray(value.channels)) { //aca valido que el channels sea un array
    details.push({ field: "channels", reason: "Debe ser un array." });
  } else {
    const validChannels: NotificationChannel[] = [];

    if (value.channels.length < 1) {//aca valido que el channels tenga longitud minima de 1
      details.push({ field: "channels", reason: "Debe contener al menos un elemento." });
    }

    if (new Set(value.channels).size !== value.channels.length) {//aca valido que el channels no tenga valores repetidos
      details.push({ field: "channels", reason: "No puede contener valores repetidos." });
    }

    value.channels.forEach((channel, index) => {//aca valido que cada elemento del channels sea un string y pertenezca al catalogo de canales permitido
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
    details.length > 0 || //si hay errores, devuelvo false y los errores
    tripId === undefined ||
    recipientId === undefined ||
    eventType === undefined ||
    channels === undefined
  ) {
    return { valid: false, details };
  }

  return { //si no hay errores, devuelvo true y los datos de la notificacion
    valid: true,
    data: {
      tripId,
      recipientId,
      eventType,
      channels,
    },
  };
}
