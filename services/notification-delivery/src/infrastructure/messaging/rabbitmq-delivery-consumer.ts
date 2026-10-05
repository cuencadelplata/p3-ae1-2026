import type { Channel, ChannelModel } from 'amqplib';
import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  NonRetryableMessagingError,
  type EventEnvelope,
  type TechnicalInboxStore,
} from '@m8/shared';
import { validateNotificationRequestedEnvelope } from '../../domain/notification-requested.contract.js';
import type { NotificationDeliveryService } from '../../services/notification-delivery.service.js';
import { StructuredLogger } from '../logging/logger.js';

export const DELIVERY_QUEUE = 'm8.delivery.notification-requested';
export const NOTIFICATION_REQUESTED_ROUTING_KEY = 'notification.requested';
export const CONSUMER_ID = 'm8.delivery.notification-requested';

export interface RabbitMqDeliveryConsumerOptions {
  connection: ChannelModel;
  inboxStore: TechnicalInboxStore;
  deliveryService: NotificationDeliveryService;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class RabbitMqDeliveryConsumer {
  private channel?: Channel;
  private consumer?: EventConsumer;
  private isRunning: boolean = false;

  constructor(private readonly options: RabbitMqDeliveryConsumerOptions) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Canal con soporte de Publisher Confirms exigido por RF8.6
    const confirmChannel = await this.options.connection.createConfirmChannel();
    this.channel = confirmChannel;

    const topology = buildQueueTopology({
      queue: DELIVERY_QUEUE,
      routingKey: NOTIFICATION_REQUESTED_ROUTING_KEY,
    });

    // Afirmar topología durable compartida (mobility.events, DLX mobility.events.dlx, colas y bindings)
    await assertTopology(this.channel, topology);

    this.consumer = new EventConsumer({
      consumerId: CONSUMER_ID,
      topology: {
        queue: DELIVERY_QUEUE,
        routingKey: NOTIFICATION_REQUESTED_ROUTING_KEY,
      },
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 5000,
      logger: {
        info: (msg: string, meta?: unknown) =>
          StructuredLogger.info({
            event: 'AMQP_CONSUMER_INFO',
            messageId: 'consumer',
            error: `${msg} ${meta ? JSON.stringify(meta) : ''}`.trim(),
          }),
        warn: (msg: string, meta?: unknown) =>
          StructuredLogger.warn({
            event: 'AMQP_CONSUMER_WARN',
            messageId: 'consumer',
            error: `${msg} ${meta ? JSON.stringify(meta) : ''}`.trim(),
          }),
        error: (msg: string, meta?: unknown) =>
          StructuredLogger.error({
            event: 'AMQP_CONSUMER_ERROR',
            messageId: 'consumer',
            error: `${msg} ${meta ? JSON.stringify(meta) : ''}`.trim(),
          }),
      },
    });

    // Registrar handler de negocio para NotificationRequested
    this.consumer.registerHandler('NotificationRequested', async (rawEnvelope: EventEnvelope<any>) => {
      // 1. Validar contrato formal M8 de sobre y datos
      const envelope = validateNotificationRequestedEnvelope(rawEnvelope);

      // 2. Procesar entrega PUSH delegada a RF8.7
      // Se pasa skipInboxClaim: true porque EventConsumer de RF8.6 ya realizó el claim técnico en messaging.inbox_events
      const result = await this.options.deliveryService.processNotificationRequest(envelope, {
        skipInboxClaim: true,
      });

      // 3. Manejo de fallas permanentes: derivar inmediatamente a DLQ
      if (result.actionTaken === 'FAILED') {
        throw new NonRetryableMessagingError(
          result.error ?? 'Push delivery permanently failed'
        );
      }
    });

    await this.consumer.start(this.channel);
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.channel) return;
    if (this.consumer) {
      await this.consumer.stop(this.channel).catch(() => {});
    }
    await this.channel.close().catch(() => {});
    this.channel = undefined;
    this.isRunning = false;
  }

  isReady(): boolean {
    return this.isRunning && !!this.channel;
  }

  getChannel(): Channel | undefined {
    return this.channel;
  }
}
