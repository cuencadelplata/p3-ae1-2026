export const EVENT_TYPES = [ // los eventos que puede recibir la notificacion
  "TRIP_REQUESTED",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_CANCELLED",
  "TRIP_COMPLETED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const TRIP_NOTIFICATION_EVENT_TYPES = [
  "TripRequested",
  "TripAssigned",
  "DriverArrived",
  "TripStarted",
  "TripCancelled",
  "TripCompleted",
] as const;

export type TripNotificationEventType = (typeof TRIP_NOTIFICATION_EVENT_TYPES)[number];

export const HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE: Record<
  EventType,
  TripNotificationEventType
> = {
  TRIP_REQUESTED: "TripRequested",
  DRIVER_ASSIGNED: "TripAssigned",
  DRIVER_ARRIVED: "DriverArrived",
  TRIP_STARTED: "TripStarted",
  TRIP_CANCELLED: "TripCancelled",
  TRIP_COMPLETED: "TripCompleted",
};

export const TRIP_NOTIFICATION_EVENT_TYPE_TO_EVENT_TYPE: Record<
  TripNotificationEventType,
  EventType
> = {
  TripRequested: "TRIP_REQUESTED",
  TripAssigned: "DRIVER_ASSIGNED",
  DriverArrived: "DRIVER_ARRIVED",
  TripStarted: "TRIP_STARTED",
  TripCancelled: "TRIP_CANCELLED",
  TripCompleted: "TRIP_COMPLETED",
};

export const NOTIFICATION_CHANNELS = ["PUSH"] as const; // los canales por los que se puede enviar la notificacion

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const ERROR_CODES = [//tipos de error que puede devolver el servidor
  "VALIDATION_ERROR",
  "UNSUPPORTED_MEDIA_TYPE",
  "NOTIFICATION_PROCESSING_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const NOTIFICATION_STATUSES = ["PROCESSED"] as const; // los estados de la notificacion

export interface NotificationRequest {//tipos de la notificacion que envia el cliente
  tripId: string;
  recipientId: string;
  eventType: EventType;
  channels: NotificationChannel[];
}

export interface Notification {//tipos de la notificacion que devuelve el servidor
  notificationId: string;
  tripId: string;
  recipientId: string;
  eventType: EventType;
  channels: NotificationChannel[];
  message: string;
  status: (typeof NOTIFICATION_STATUSES)[number];
  createdAt: string;
}

export interface NormalizedTripNotificationEvent {
  messageId: string;
  eventType: TripNotificationEventType;
  tripId: string;
  recipientId: string;
  correlationId: string;
  occurredAt: string;
}

export interface LogicalNotification {
  notificationId: string;
  sourceMessageId: string;
  tripId: string;
  recipientId: string;
  eventType: TripNotificationEventType;
  title: string;
  message: string;
  correlationId: string;
  occurredAt: string;
  createdAt: string;
}

export interface ErrorDetail {//tipos de detalle del error
  field: string;
  reason: string;
}

export interface ErrorResponse {//tipos de respuesta del error
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

// --- Contrato Congelado RF8.6 -> RF8.1 (Integración Asíncrona RabbitMQ) ---

export const TRIP_EVENT_TYPE_MAP = {
  TripRequested: "TRIP_REQUESTED",
  DriverAssigned: "DRIVER_ASSIGNED",
  DriverArrived: "DRIVER_ARRIVED",
  TripStarted: "TRIP_STARTED",
  TripCancelled: "TRIP_CANCELLED",
  TripCompleted: "TRIP_COMPLETED",
} as const;

export type AmqpTripEventType = keyof typeof TRIP_EVENT_TYPE_MAP;

export interface TripEventData {
  tripId: string;
  recipientId: string;
  details?: Record<string, unknown>;
}

export interface TripEventEnvelope {
  messageId: string;
  eventType: AmqpTripEventType | string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: TripEventData;
}

// --- Contrato Congelado RF8.1 -> RF8.7 (Outbox NotificationRequested) ---

export interface NotificationRequestedData {
  notificationId: string;
  tripId: string;
  recipientId: string;
  eventType: EventType;
  channel: NotificationChannel;
  message: string;
  createdAt: string;
}

export interface NotificationRequestedEnvelope {
  messageId: string;
  eventType: "NotificationRequested";
  version: 1;
  occurredAt: string;
  correlationId: string;
  producer: "m8-notifications";
  data: NotificationRequestedData;
}

