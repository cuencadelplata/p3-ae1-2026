import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
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
  userId: number;
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

export class PgDeliveryRepository implements DeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async createDelivery(params: CreateDeliveryParams): Promise<DeliveryRequest> {
    const res = await this.pool.query(
      `INSERT INTO notification_delivery.delivery_requests
       (notification_id, message_id, trip_id, user_id, event_type, channel, status, title, message, device_token)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9)
       RETURNING delivery_id, notification_id, message_id, trip_id, user_id, event_type, channel, status, title, message, device_token, skip_reason, created_at, updated_at`,
      [
        params.notificationId,
        params.messageId,
        params.tripId,
        params.userId,
        params.eventType,
        params.channel,
        params.title,
        params.message,
        params.deviceToken,
      ]
    );
    return this.mapDeliveryRow(res.rows[0]);
  }

  async recordAttempt(params: RecordAttemptParams): Promise<DeliveryAttempt> {
    const res = await this.pool.query(
      `INSERT INTO notification_delivery.delivery_attempts
       (delivery_id, attempt_number, status, provider_response, error_message, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING attempt_id, delivery_id, attempt_number, status, provider_response, error_message, latency_ms, attempted_at`,
      [
        params.deliveryId,
        params.attemptNumber,
        params.status,
        params.providerResponse,
        params.errorMessage,
        params.latencyMs,
      ]
    );
    const row = res.rows[0];
    return {
      attemptId: row.attempt_id,
      deliveryId: row.delivery_id,
      attemptNumber: row.attempt_number,
      status: row.status,
      providerResponse: row.provider_response,
      errorMessage: row.error_message,
      latencyMs: row.latency_ms,
      attemptedAt: new Date(row.attempted_at).toISOString(),
    };
  }

  async updateStatus(
    deliveryId: string,
    status: DeliveryStatus,
    skipReason?: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE notification_delivery.delivery_requests
       SET status = $2, skip_reason = COALESCE($3, skip_reason), updated_at = NOW()
       WHERE delivery_id = $1`,
      [deliveryId, status, skipReason]
    );
  }

  async getByNotificationId(notificationId: string): Promise<DeliveryWithAttempts | null> {
    const res = await this.pool.query(
      `SELECT delivery_id, notification_id, message_id, trip_id, user_id, event_type, channel, status, title, message, device_token, skip_reason, created_at, updated_at
       FROM notification_delivery.delivery_requests
       WHERE notification_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [notificationId]
    );
    if (res.rows.length === 0) return null;
    return this.fetchWithAttempts(res.rows[0]);
  }

  async getByMessageId(messageId: string): Promise<DeliveryWithAttempts | null> {
    const res = await this.pool.query(
      `SELECT delivery_id, notification_id, message_id, trip_id, user_id, event_type, channel, status, title, message, device_token, skip_reason, created_at, updated_at
       FROM notification_delivery.delivery_requests
       WHERE message_id = $1
       LIMIT 1`,
      [messageId]
    );
    if (res.rows.length === 0) return null;
    return this.fetchWithAttempts(res.rows[0]);
  }

  private async fetchWithAttempts(row: Record<string, any>): Promise<DeliveryWithAttempts> {
    const delivery = this.mapDeliveryRow(row);
    const attemptsRes = await this.pool.query(
      `SELECT attempt_id, delivery_id, attempt_number, status, provider_response, error_message, latency_ms, attempted_at
       FROM notification_delivery.delivery_attempts
       WHERE delivery_id = $1
       ORDER BY attempt_number ASC`,
      [delivery.deliveryId]
    );
    const attempts: DeliveryAttempt[] = attemptsRes.rows.map((att: any) => ({
      attemptId: att.attempt_id,
      deliveryId: att.delivery_id,
      attemptNumber: att.attempt_number,
      status: att.status,
      providerResponse: att.provider_response,
      errorMessage: att.error_message,
      latencyMs: att.latency_ms,
      attemptedAt: new Date(att.attempted_at).toISOString(),
    }));
    return {
      ...delivery,
      attempts,
    };
  }

  private mapDeliveryRow(row: Record<string, any>): DeliveryRequest {
    return {
      deliveryId: row.delivery_id,
      notificationId: row.notification_id,
      messageId: row.message_id,
      tripId: row.trip_id,
      userId: Number(row.user_id),
      eventType: row.event_type,
      channel: row.channel,
      status: row.status,
      title: row.title,
      message: row.message,
      deviceToken: row.device_token,
      skipReason: row.skip_reason,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
