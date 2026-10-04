import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { RabbitMqConnection } from '../infrastructure/rabbitmq/rabbitmq.connection.js';
import type { EventEnvelope } from './event-envelope.js';
import type { IdempotentEventHandler } from './processed-event.repository.js';

export class RabbitMqConsumer {
  private startedChannel: ConfirmChannel | null = null;

  public constructor(
    private readonly connection: RabbitMqConnection,
    private readonly retryLimit: number,
    private readonly idempotency?: IdempotentEventHandler,
  ) {}

  public async start(
    bindings: string[],
    handler: (event: EventEnvelope, routingKey: string) => Promise<void>,
  ): Promise<void> {
    const channel = this.connection.getChannel();
    if (this.startedChannel === channel) return;
    for (const binding of bindings) {
      await channel.bindQueue(
        this.connection.topology.queue,
        this.connection.topology.exchange,
        binding,
      );
    }
    await channel.prefetch(1);
    await channel.consume(this.connection.topology.queue, async (message) => {
      if (message === null) return;
      await this.consumeMessage(message, handler);
    });
    this.startedChannel = channel;
  }

  private async consumeMessage(
    message: ConsumeMessage,
    handler: (event: EventEnvelope, routingKey: string) => Promise<void>,
  ): Promise<void> {
    const channel = this.connection.getChannel();
    try {
      const event = JSON.parse(message.content.toString('utf8')) as EventEnvelope;
      if (this.idempotency === undefined) {
        await handler(event, message.fields.routingKey);
      } else {
        await this.idempotency.handle(event.eventId, () =>
          handler(event, message.fields.routingKey),
        );
      }
      channel.ack(message);
    } catch {
      const retryCount = this.retryCount(message);
      if (retryCount < this.retryLimit) {
        channel.publish(
          this.connection.topology.retryExchange,
          message.fields.routingKey,
          message.content,
          {
            persistent: true,
            contentType: message.properties.contentType,
            messageId: message.properties.messageId,
            correlationId: message.properties.correlationId,
            type: message.properties.type,
            timestamp: message.properties.timestamp,
            headers: {
              ...message.properties.headers,
              'x-retry-count': retryCount + 1,
            },
          },
        );
        await channel.waitForConfirms();
        channel.ack(message);
      } else {
        channel.nack(message, false, false);
      }
    }
  }

  private retryCount(message: ConsumeMessage): number {
    const value = message.properties.headers?.['x-retry-count'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  }
}
