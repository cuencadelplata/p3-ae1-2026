import type { LogicalNotification } from "./notification.types";
import type { SaveNotificationResult } from "./notification.repository";

export const NOTIFICATION_REQUESTED_EVENT_TYPE = "NotificationRequested";
export const NOTIFICATION_REQUESTED_ROUTING_KEY = "notification.requested";
export const NOTIFICATION_REQUESTED_VERSION = 1;
export const M8_PRODUCER = "m8";

export interface NotificationOutboxIntent {
  messageId: string;
  notificationId: string;
  eventType: typeof NOTIFICATION_REQUESTED_EVENT_TYPE;
  routingKey: typeof NOTIFICATION_REQUESTED_ROUTING_KEY;
  correlationId: string;
  version: typeof NOTIFICATION_REQUESTED_VERSION;
  producer: typeof M8_PRODUCER;
  payload: null;
  createdAt: string;
  publishedAt: string | null;
}

export interface SaveNotificationWithOutboxResult extends SaveNotificationResult {
  outbox: NotificationOutboxIntent;
}

export interface NotificationWithOutboxRepository {
  saveWithOutbox(notification: LogicalNotification): Promise<SaveNotificationWithOutboxResult>;
}
