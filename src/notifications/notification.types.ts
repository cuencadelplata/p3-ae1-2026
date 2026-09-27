export const EVENT_TYPES = [ // los eventos que puede recibir la notificacion
  "TRIP_REQUESTED",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_CANCELLED",
  "TRIP_COMPLETED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

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
