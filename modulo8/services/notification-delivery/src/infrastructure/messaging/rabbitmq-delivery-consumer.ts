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

export async function processPushEvent(rawEnvelope: EventEnvelope<unknown>, deliveryService: NotificationDeliveryService) {
  const envelope = validateNotificationRequestedEnvelope(rawEnvelope);
  // EventConsumer ya registró el mensaje en el Inbox técnico.
  const result = await deliveryService.processNotificationRequest(envelope, { skipInboxClaim: true });
  // Sin suscripción no hay un envío para reintentar. La ausencia queda registrada por RF8.7.
  if (result.actionTaken === 'FAILED' && result.status !== 'FAILED_NO_DEVICE_TOKEN') {
    throw new NonRetryableMessagingError(result.error ?? 'Push delivery permanently failed');
  }
}

export interface RabbitMqDeliveryConsumerOptions {
  connection: ChannelModel;
  inboxStore: TechnicalInboxStore;
  deliveryService: NotificationDeliveryService;
  maxRetries?: number;
  retryDelayMs?: number;
  onDisconnected?: () => void;
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
    let channelClosed = false;
    confirmChannel.on('error', (error) => {
      StructuredLogger.warn({ event: 'AMQP_CHANNEL_ERROR', messageId: 'consumer', error: String(error) });
    });
    confirmChannel.on('close', () => {
      channelClosed = true;
      this.isRunning = false;
      this.options.onDisconnected?.();
    });

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

    this.consumer.registerHandler('NotificationRequested', rawEnvelope =>
      processPushEvent(rawEnvelope, this.options.deliveryService));

    await this.consumer.start(this.channel);
    if (channelClosed) throw new Error('El canal RabbitMQ se cerró durante el arranque de RF8.7.');
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.channel) return;
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
