import type {
  DeliveryEventType,
  DeliveryProcessingResult,
  NotificationRequestedEnvelope,
} from '../domain/delivery.types.js';
import type { PushDeliveryProvider } from '../infrastructure/provider/push-delivery-provider.js';
import type { MessagingInboxRepository } from '../infrastructure/database/inbox.repository.js';
import type { DeliveryRepository } from '../infrastructure/database/delivery.repository.js';
import type { DeviceTokenRepository } from '../infrastructure/database/device-token.repository.js';
import type { M2PreferencesClient } from '../infrastructure/clients/m2-preferences.client.js';
import { StructuredLogger } from '../infrastructure/logging/logger.js';

const CANONICAL_TITLES: Record<DeliveryEventType, string> = {
  TRIP_REQUESTED: 'Solicitud de viaje',
  DRIVER_ASSIGNED: 'Conductor asignado',
  DRIVER_ARRIVED: 'Tu conductor ha llegado',
  TRIP_STARTED: 'Viaje en curso',
  TRIP_CANCELLED: 'Viaje cancelado',
  TRIP_COMPLETED: 'Viaje finalizado',
};

export const CONSUMER_ID = 'm8.delivery.notification-requested';

export interface DeliveryServiceConfig {
  maxAttempts?: number;
  initialBackoffMs?: number;
  leaseSeconds?: number;
}

export class NotificationDeliveryService {
  private maxAttempts: number;
  private initialBackoffMs: number;
  private leaseSeconds: number;

  constructor(
    private readonly inboxRepo: MessagingInboxRepository,
    private readonly deliveryRepo: DeliveryRepository,
    private readonly tokenRepo: DeviceTokenRepository,
    private readonly m2Client: M2PreferencesClient,
    private readonly pushProvider: PushDeliveryProvider,
    config: DeliveryServiceConfig = {}
  ) {
    this.maxAttempts = config.maxAttempts ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 50;
    this.leaseSeconds = config.leaseSeconds ?? 30;
  }

  async processNotificationRequest(
    envelope: NotificationRequestedEnvelope,
    options: { skipInboxClaim?: boolean } = {}
  ): Promise<DeliveryProcessingResult> {
    const { messageId, correlationId, data } = envelope;
    const userId = data.recipientId;

    if (!options.skipInboxClaim) {
      // 1. Reclamo en messaging.inbox_events de RF8.6 (Lease / Idempotencia)
      const claim = await this.inboxRepo.claimMessage(
        CONSUMER_ID,
        messageId,
        envelope.eventType,
        this.leaseSeconds
      );

      if (claim.action === 'ALREADY_PROCESSED') {
        StructuredLogger.info({
          event: 'MESSAGE_ALREADY_PROCESSED_IDEMPOTENT',
          messageId,
          notificationId: data.notificationId,
          userId: String(userId),
          correlationId,
          tripId: data.tripId,
          result: 'ACK_DUPLICATE_NO_PUSH',
        });

        return {
          messageId,
          notificationId: data.notificationId,
          actionTaken: 'ACK_DUPLICATE',
          status: 'ALREADY_PROCESSED',
          attemptsCount: 0,
        };
      }

      if (claim.action === 'LEASE_ACTIVE') {
        StructuredLogger.warn({
          event: 'LEASE_ACTIVE_ANOTHER_CONSUMER',
          messageId,
          notificationId: data.notificationId,
          userId: String(userId),
          correlationId,
          tripId: data.tripId,
          result: 'SKIPPED_IN_FLIGHT',
        });

        return {
          messageId,
          notificationId: data.notificationId,
          actionTaken: 'IGNORED_LEASE_ACTIVE',
          status: 'PENDING',
          attemptsCount: 0,
        };
      }
    }

    // 2. Consulta de preferencias en M2
    try {
      const preferences = await this.m2Client.getPreferences(userId, correlationId);
      if (!preferences.notificationsEnabled || !preferences.pushEnabled) {
        StructuredLogger.info({
          event: 'DELIVERY_SKIPPED_PREFERENCE_OFF',
          messageId,
          notificationId: data.notificationId,
          userId,
          correlationId,
          tripId: data.tripId,
          result: 'SKIPPED_PREFERENCE_OFF',
        });

        const record = await this.deliveryRepo.createDelivery({
          notificationId: data.notificationId,
          messageId,
          tripId: data.tripId,
          userId,
          eventType: data.eventType,
          channel: 'PUSH',
          message: data.message,
        });

        await this.deliveryRepo.updateStatus(
          record.deliveryId,
          'SKIPPED_PREFERENCE_OFF',
          'M2_PREFERENCE_DISABLED'
        );
        if (!options.skipInboxClaim) {
          await this.inboxRepo.markProcessed(CONSUMER_ID, messageId);
        }

        return {
          messageId,
          notificationId: data.notificationId,
          actionTaken: 'SKIPPED_PREFERENCE_OFF',
          status: 'SKIPPED_PREFERENCE_OFF',
          skipReason: 'M2_PREFERENCE_DISABLED',
          attemptsCount: 0,
        };
      }
    } catch (m2Err: unknown) {
      const errMessage = m2Err instanceof Error ? m2Err.message : 'Error en M2';
      StructuredLogger.error({
        event: 'M2_PREFERENCES_ERROR',
        messageId,
        notificationId: data.notificationId,
        userId,
        correlationId,
        error: errMessage,
      });
      // Si falla M2 por error de red transitorio, relanzar para activar política de reintentos
      throw m2Err;
    }

    // 3. Resolución de Device Token en M8
    const activeTokenRecord = await this.tokenRepo.getLatestActiveTokenByUserId(userId);
    const resolvedDeviceToken =
      activeTokenRecord?.token || data.targetDestination || undefined;

    if (!resolvedDeviceToken) {
      StructuredLogger.warn({
        event: 'FAILED_NO_DEVICE_TOKEN',
        messageId,
        notificationId: data.notificationId,
        userId,
        correlationId,
        tripId: data.tripId,
        result: 'FAILED_NO_DEVICE_TOKEN',
      });

      const record = await this.deliveryRepo.createDelivery({
        notificationId: data.notificationId,
        messageId,
        tripId: data.tripId,
        userId,
        eventType: data.eventType,
        channel: 'PUSH',
        message: data.message,
      });

      await this.deliveryRepo.updateStatus(
        record.deliveryId,
        'FAILED_NO_DEVICE_TOKEN',
        'NO_ACTIVE_DEVICE_TOKEN'
      );
      if (!options.skipInboxClaim) {
        await this.inboxRepo.markProcessed(CONSUMER_ID, messageId);
      }

      return {
        messageId,
        notificationId: data.notificationId,
        actionTaken: 'FAILED',
        status: 'FAILED_NO_DEVICE_TOKEN',
        skipReason: 'NO_ACTIVE_DEVICE_TOKEN',
        attemptsCount: 0,
        error: 'Usuario no posee ningún device token activo para entrega PUSH.',
      };
    }

    // 4. Preparación de envío PUSH
    const title = data.title || CANONICAL_TITLES[data.eventType] || 'Notificación de Viaje';

    const deliveryRecord = await this.deliveryRepo.createDelivery({
      notificationId: data.notificationId,
      messageId,
      tripId: data.tripId,
      userId,
      eventType: data.eventType,
      channel: 'PUSH',
      title,
      message: data.message,
      deviceToken: resolvedDeviceToken,
    });

    let currentAttempt = 0;
    let lastError: string | undefined;

    // 5. Ciclo de reintentos internos ante el proveedor PUSH (máximo 3)
    while (currentAttempt < this.maxAttempts) {
      currentAttempt += 1;

      const result = await this.pushProvider.sendPush({
        notificationId: data.notificationId,
        tripId: data.tripId,
        recipientId: userId,
        deviceToken: resolvedDeviceToken,
        title,
        body: data.message,
        priority: data.priority ?? 'NORMAL',
        correlationId,
      });

      if (result.success) {
        await this.deliveryRepo.recordAttempt({
          deliveryId: deliveryRecord.deliveryId,
          attemptNumber: currentAttempt,
          status: 'SUCCESS',
          providerResponse: result.providerMessageId,
          latencyMs: result.latencyMs,
        });

        await this.deliveryRepo.updateStatus(deliveryRecord.deliveryId, 'DELIVERED');
        if (!options.skipInboxClaim) {
          await this.inboxRepo.markProcessed(CONSUMER_ID, messageId);
        }

        StructuredLogger.info({
          event: 'PUSH_DELIVERY_SUCCESS',
          messageId,
          notificationId: data.notificationId,
          userId: String(userId),
          correlationId,
          tripId: data.tripId,
          attempt: currentAttempt,
          latencyMs: result.latencyMs,
          result: 'DELIVERED',
        });

        return {
          messageId,
          notificationId: data.notificationId,
          actionTaken: 'DELIVERED',
          status: 'DELIVERED',
          attemptsCount: currentAttempt,
          deliveredAt: new Date().toISOString(),
        };
      }

      // Registro de intento fallido
      lastError = result.error || 'Fallo desconocido del proveedor';
      await this.deliveryRepo.recordAttempt({
        deliveryId: deliveryRecord.deliveryId,
        attemptNumber: currentAttempt,
        status: 'FAILED',
        errorMessage: lastError,
        latencyMs: result.latencyMs,
      });

      StructuredLogger.warn({
        event: 'PUSH_ATTEMPT_FAILED',
        messageId,
        notificationId: data.notificationId,
        userId: String(userId),
        correlationId,
        tripId: data.tripId,
        attempt: currentAttempt,
        latencyMs: result.latencyMs,
        error: lastError,
      });

      if (currentAttempt < this.maxAttempts) {
        const delay = this.initialBackoffMs * Math.pow(2, currentAttempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // 6. Si se agotaron los 3 reintentos del proveedor, marcar FAILED para desvío a DLQ
    await this.deliveryRepo.updateStatus(deliveryRecord.deliveryId, 'FAILED');
    if (!options.skipInboxClaim) {
      await this.inboxRepo.markFailed(CONSUMER_ID, messageId);
    }

    StructuredLogger.error({
      event: 'PUSH_DELIVERY_PERMANENT_FAILURE_DLQ',
      messageId,
      notificationId: data.notificationId,
      userId: String(userId),
      correlationId,
      tripId: data.tripId,
      attempt: currentAttempt,
      error: `Agotados ${this.maxAttempts} intentos: ${lastError}`,
    });

    return {
      messageId,
      notificationId: data.notificationId,
      actionTaken: 'FAILED',
      status: 'FAILED',
      attemptsCount: currentAttempt,
      error: `Agotados ${this.maxAttempts} intentos ante el proveedor PUSH: ${lastError}`,
    };
  }

  async getDeliveryByNotificationId(notificationId: string) {
    return this.deliveryRepo.getByNotificationId(notificationId);
  }

  async getDeliveryByMessageId(messageId: string) {
    return this.deliveryRepo.getByMessageId(messageId);
  }
}
