import { randomUUID } from 'node:crypto';
import type {
  DeliveryAttempt,
  DeliveryRequest,
  DeliveryStatus,
  DeliveryWithAttempts,
  AttemptStatus,
} from '../../domain/delivery.types.js';

export interface CreateDeliveryParams {
  notificationId: string;
  messageId: string;
  tripId: string;
  userId: string;
  eventType: DeliveryRequest['eventType'];
  channel: 'PUSH';
  title?: string;
  message: string;
  deviceToken?: string;
}

export interface RecordAttemptParams {
  deliveryId: string;
  attemptNumber: number;
  status: AttemptStatus;
  providerResponse?: string;
  errorMessage?: string;
  latencyMs: number;
}

export interface DeliveryRepository {
  createDelivery(params: CreateDeliveryParams): Promise<DeliveryRequest>;
  recordAttempt(params: RecordAttemptParams): Promise<DeliveryAttempt>;
  updateStatus(deliveryId: string, status: DeliveryStatus, skipReason?: string): Promise<void>;
  getByNotificationId(notificationId: string): Promise<DeliveryWithAttempts | null>;
  getByMessageId(messageId: string): Promise<DeliveryWithAttempts | null>;
}

export class InMemoryDeliveryRepository implements DeliveryRepository {
  private deliveries = new Map<string, DeliveryRequest>();
  private attempts = new Map<string, DeliveryAttempt[]>();

  async createDelivery(params: CreateDeliveryParams): Promise<DeliveryRequest> {
    const deliveryId = randomUUID();
    const now = new Date().toISOString();

    const record: DeliveryRequest = {
      deliveryId,
      notificationId: params.notificationId,
      messageId: params.messageId,
      tripId: params.tripId,
      userId: params.userId,
      eventType: params.eventType,
      channel: params.channel,
      status: 'PENDING',
      title: params.title,
      message: params.message,
      deviceToken: params.deviceToken,
      createdAt: now,
      updatedAt: now,
    };

    this.deliveries.set(deliveryId, record);
    this.attempts.set(deliveryId, []);
    return record;
  }

  async recordAttempt(params: RecordAttemptParams): Promise<DeliveryAttempt> {
    const attempt: DeliveryAttempt = {
      attemptId: randomUUID(),
      deliveryId: params.deliveryId,
      attemptNumber: params.attemptNumber,
      status: params.status,
      providerResponse: params.providerResponse,
      errorMessage: params.errorMessage,
      latencyMs: params.latencyMs,
      attemptedAt: new Date().toISOString(),
    };

    const list = this.attempts.get(params.deliveryId) ?? [];
    list.push(attempt);
    this.attempts.set(params.deliveryId, list);

    return attempt;
  }

  async updateStatus(
    deliveryId: string,
    status: DeliveryStatus,
    skipReason?: string
  ): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery) {
      delivery.status = status;
      if (skipReason) {
        delivery.skipReason = skipReason;
      }
      delivery.updatedAt = new Date().toISOString();
    }
  }

  async getByNotificationId(notificationId: string): Promise<DeliveryWithAttempts | null> {
    for (const delivery of this.deliveries.values()) {
      if (delivery.notificationId === notificationId) {
        const attemptList = this.attempts.get(delivery.deliveryId) ?? [];
        return {
          ...delivery,
          attempts: [...attemptList],
        };
      }
    }
    return null;
  }

  async getByMessageId(messageId: string): Promise<DeliveryWithAttempts | null> {
    for (const delivery of this.deliveries.values()) {
      if (delivery.messageId === messageId) {
        const attemptList = this.attempts.get(delivery.deliveryId) ?? [];
        return {
          ...delivery,
          attempts: [...attemptList],
        };
      }
    }
    return null;
  }
}
