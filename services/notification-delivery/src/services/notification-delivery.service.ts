import type {
  DeliveryEventType,
  DeliveryProcessingResult,
  NotificationRequestedEnvelope,
} from '../domain/delivery.types.js';
import type { PushDeliveryProvider } from '../infrastructure/provider/push-delivery-provider.js';
import type { InboxRepository } from '../infrastructure/database/inbox.repository.js';
import type { DeliveryRepository } from '../infrastructure/database/delivery.repository.js';

const CANONICAL_TITLES: Record<DeliveryEventType, string> = {
  TRIP_REQUESTED: 'Solicitud de viaje',
  DRIVER_ASSIGNED: 'Conductor asignado',
  DRIVER_ARRIVED: 'Tu conductor ha llegado',
  TRIP_STARTED: 'Viaje en curso',
  TRIP_CANCELLED: 'Viaje cancelado',
  TRIP_COMPLETED: 'Viaje finalizado',
};

export interface DeliveryServiceConfig {
  maxAttempts?: number;
  initialBackoffMs?: number;
}

export class NotificationDeliveryService {
  private maxAttempts: number;
  private initialBackoffMs: number;

  constructor(
    private readonly inboxRepo: InboxRepository,
    private readonly deliveryRepo: DeliveryRepository,
    private readonly pushProvider: PushDeliveryProvider,
    config: DeliveryServiceConfig = {}
  ) {
    this.maxAttempts = config.maxAttempts ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 50;
  }

  async processNotificationRequest(
    envelope: NotificationRequestedEnvelope
  ): Promise<DeliveryProcessingResult> {
    const { messageId, correlationId, data } = envelope;

    // 1. Idempotencia y Deduplicación en Inbox
    const { isDuplicate } = await this.inboxRepo.saveOrIgnore(
      messageId,
      'm8.delivery.notification-requested',
      envelope.eventType
    );

    if (isDuplicate) {
      return {
        messageId,
        notificationId: data.notificationId,
        duplicate: true,
        status: 'DUPLICATE_IGNORED',
        attemptsCount: 0,
      };
    }

    // 2. Preparación del payload de entrega
    const title = data.title || CANONICAL_TITLES[data.eventType] || 'Notificación de Viaje';
    const targetDestination = data.targetDestination || `sandbox_token_${data.recipientId}`;

    const deliveryRecord = await this.deliveryRepo.createDelivery({
      notificationId: data.notificationId,
      messageId,
      tripId: data.tripId,
      recipientId: data.recipientId,
      eventType: data.eventType,
      channel: 'PUSH',
      title,
      message: data.message,
      targetDestination,
    });

    let currentAttempt = 0;
    let lastError: string | undefined;

    // 3. Bucle de intentos con reintentos y backoff ante fallos transitorios
    while (currentAttempt < this.maxAttempts) {
      currentAttempt += 1;

      const result = await this.pushProvider.sendPush({
        notificationId: data.notificationId,
        tripId: data.tripId,
        recipientId: data.recipientId,
        targetDestination,
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
        await this.inboxRepo.updateStatus(messageId, 'PROCESSED');

        return {
          messageId,
          notificationId: data.notificationId,
          duplicate: false,
          status: 'DELIVERED',
          attemptsCount: currentAttempt,
          deliveredAt: new Date().toISOString(),
        };
      }

      // Registro de intento fallido
      lastError = result.error || 'Error desconocido del proveedor';
      await this.deliveryRepo.recordAttempt({
        deliveryId: deliveryRecord.deliveryId,
        attemptNumber: currentAttempt,
        status: 'FAILED',
        errorMessage: lastError,
        latencyMs: result.latencyMs,
      });

      // Si aún restan intentos, esperar backoff exponencial
      if (currentAttempt < this.maxAttempts) {
        const delay = this.initialBackoffMs * Math.pow(2, currentAttempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // 4. Si se agotaron los intentos, marcar como fallido para desvío a DLQ
    await this.deliveryRepo.updateStatus(deliveryRecord.deliveryId, 'FAILED');
    await this.inboxRepo.updateStatus(messageId, 'FAILED');

    return {
      messageId,
      notificationId: data.notificationId,
      duplicate: false,
      status: 'FAILED',
      attemptsCount: currentAttempt,
      error: `Agotados ${this.maxAttempts} intentos: ${lastError}`,
    };
  }

  async getDeliveryByNotificationId(notificationId: string) {
    return this.deliveryRepo.getByNotificationId(notificationId);
  }

  async getDeliveryByMessageId(messageId: string) {
    return this.deliveryRepo.getByMessageId(messageId);
  }
}
