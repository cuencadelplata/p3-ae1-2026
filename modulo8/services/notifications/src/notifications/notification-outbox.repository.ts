import type { PoolClient } from "pg";

import type { LogicalNotification, NotificationRequestedData, NotificationRequestedEnvelope } from "./notification.types";
import type { SaveNotificationResult } from "./notification.repository";

export const NOTIFICATION_REQUESTED_EVENT_TYPE = "NotificationRequested";
export const NOTIFICATION_REQUESTED_ROUTING_KEY = "notification.requested";
export const NOTIFICATION_REQUESTED_VERSION = 1;
export const M8_PRODUCER = "m8-notifications";

export interface NotificationOutboxIntent {
  messageId: string;
  notificationId: string;
  eventType: typeof NOTIFICATION_REQUESTED_EVENT_TYPE;
  routingKey: typeof NOTIFICATION_REQUESTED_ROUTING_KEY;
  correlationId: string;
  version: typeof NOTIFICATION_REQUESTED_VERSION;
  producer: typeof M8_PRODUCER;
  payload: NotificationRequestedData;
  createdAt: string;
  publishedAt: string | null;
}

export interface NotificationDeliveryIntent {
  outboxMessageId: string;
  notificationId: string;
  recipientId: string | number;
  tripId: string | null;
  rideRequestId: string | null;
  sourceMessageId: string;
  notificationEventType: LogicalNotification["eventType"];
  title: string;
  message: string;
  correlationId: string;
  notificationCreatedAt: string;
  outboxCreatedAt: string;
}

export interface SaveNotificationWithOutboxResult extends SaveNotificationResult {
  outbox: NotificationOutboxIntent;
}

export interface NotificationWithOutboxRepository {
  saveWithOutbox(notification: LogicalNotification): Promise<SaveNotificationWithOutboxResult>;
  saveWithOutboxUsingClient(
    client: PoolClient,
    notification: LogicalNotification,
  ): Promise<SaveNotificationWithOutboxResult>;
  findPending(limit: number): Promise<NotificationDeliveryIntent[]>;
  claimPendingForPublish(client: PoolClient, limit: number): Promise<NotificationRequestedEnvelope[]>;
  markPublished(messageId: string, publishedAt: string): Promise<boolean>;
  markPublishedWithClient(client: PoolClient, messageId: string, publishedAt: string): Promise<boolean>;
}
