export const EVENT_TYPES = [
  "TRIP_REQUESTED",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_CANCELLED",
  "TRIP_COMPLETED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["PUSH"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNSUPPORTED_MEDIA_TYPE",
  "NOTIFICATION_PROCESSING_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const NOTIFICATION_STATUSES = ["PROCESSED"] as const;

export interface NotificationRequest {
  tripId: string;
  recipientId: string;
  eventType: EventType;
  channels: NotificationChannel[];
}

export interface Notification {
  notificationId: string;
  tripId: string;
  recipientId: string;
  eventType: EventType;
  channels: NotificationChannel[];
  message: string;
  status: (typeof NOTIFICATION_STATUSES)[number];
  createdAt: string;
}

export interface ErrorDetail {
  field: string;
  reason: string;
}

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}
