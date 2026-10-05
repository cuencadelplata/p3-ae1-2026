export type DeliveryEventType =
  | 'TRIP_REQUESTED'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'TRIP_CANCELLED'
  | 'TRIP_COMPLETED';

export type DeliveryChannel = 'PUSH';

export type DeliveryPriority = 'HIGH' | 'NORMAL';

export type DeliveryStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'FAILED'
  | 'SKIPPED_PREFERENCE_OFF'
  | 'FAILED_NO_DEVICE_TOKEN';

export type AttemptStatus = 'SUCCESS' | 'FAILED';

export type InboxStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

export type InboxClaimAction = 'CLAIMED' | 'ALREADY_PROCESSED' | 'LEASE_ACTIVE';

export interface InboxClaimResult {
  action: InboxClaimAction;
  leaseUntil?: string;
}

export interface NotificationRequestedData {
  notificationId: string;
  tripId: string;
  recipientId: string; // Corresponde al userId canónico de M1
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

export interface DeviceTokenRecord {
  tokenId: string;
  userId: string;
  token: string;
  platform: 'ANDROID' | 'IOS' | 'WEB';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRequest {
  deliveryId: string;
  notificationId: string;
  messageId: string;
  tripId: string;
  userId: string;
  eventType: DeliveryEventType;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  title?: string;
  message: string;
  deviceToken?: string;
  skipReason?: string;
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

export interface PushSendRequest {
  notificationId: string;
  tripId: string;
  recipientId: string;
  deviceToken: string;
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
  isTransient?: boolean;
}

export interface UserPreferences {
  userId: string;
  notificationsEnabled: boolean;
  pushEnabled: boolean;
}

export interface DeliveryProcessingResult {
  messageId: string;
  notificationId: string;
  actionTaken: 'DELIVERED' | 'SKIPPED_PREFERENCE_OFF' | 'FAILED' | 'ACK_DUPLICATE' | 'IGNORED_LEASE_ACTIVE';
  status: DeliveryStatus | 'ALREADY_PROCESSED';
  attemptsCount: number;
  deliveredAt?: string;
  error?: string;
  skipReason?: string;
}
