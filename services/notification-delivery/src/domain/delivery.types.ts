export type DeliveryEventType =
  | 'TRIP_REQUESTED'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'TRIP_CANCELLED'
  | 'TRIP_COMPLETED';

export type DeliveryChannel = 'PUSH';

export type DeliveryPriority = 'HIGH' | 'NORMAL';

export type DeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type AttemptStatus = 'SUCCESS' | 'FAILED';

export type InboxStatus = 'RECEIVED' | 'PROCESSED' | 'DUPLICATE_IGNORED' | 'FAILED';

export interface NotificationRequestedData {
  notificationId: string;
  tripId: string;
  recipientId: string;
  eventType: DeliveryEventType;
  channel: DeliveryChannel;
  title?: string;
  message: string;
  targetDestination?: string;
  priority?: DeliveryPriority;
  createdAt: string;
}

export interface NotificationRequestedEnvelope {
  messageId: string;
  eventType: 'NotificationRequested';
  version: 1;
  occurredAt: string;
  correlationId: string;
  producer: 'm8-notifications';
  data: NotificationRequestedData;
}

export interface DeliveryRequest {
  deliveryId: string;
  notificationId: string;
  messageId: string;
  tripId: string;
  recipientId: string;
  eventType: DeliveryEventType;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  title?: string;
  message: string;
  targetDestination?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  attemptId: string;
  deliveryId: string;
  attemptNumber: number;
  status: AttemptStatus;
  providerResponse?: string;
  errorMessage?: string;
  latencyMs: number;
  attemptedAt: string;
}

export interface DeliveryWithAttempts extends DeliveryRequest {
  attempts: DeliveryAttempt[];
}

export interface InboxRecord {
  messageId: string;
  consumerId: string;
  eventType: string;
  receivedAt: string;
  processedAt?: string;
  status: InboxStatus;
}

export interface PushSendRequest {
  notificationId: string;
  tripId: string;
  recipientId: string;
  targetDestination: string;
  title: string;
  body: string;
  priority: DeliveryPriority;
  correlationId: string;
}

export interface PushSendResult {
  success: boolean;
  providerMessageId?: string;
  statusCode: number;
  latencyMs: number;
  error?: string;
}

export interface DeliveryProcessingResult {
  messageId: string;
  notificationId: string;
  duplicate: boolean;
  status: DeliveryStatus | 'DUPLICATE_IGNORED';
  attemptsCount: number;
  deliveredAt?: string;
  error?: string;
}
