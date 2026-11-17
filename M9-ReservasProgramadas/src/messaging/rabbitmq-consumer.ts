import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { RabbitMqConnection } from '../infrastructure/rabbitmq/rabbitmq.connection.js';
import { now, recordMessagingConsume, recordMessagingPublish } from '../observability/metrics.js';
import { extractTraceContext, SpanKind, withSpan } from '../observability/tracing.js';
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
    const startMs = now();
    const eventType = typeof message.properties.type === 'string' ? message.properties.type : '';
    const retryCount = this.retryCount(message);
    try {
      // Span CONSUMER hijo del `traceparent` recibido (se conserva en retry y DLQ).
      await withSpan(
        `process ${eventType || 'message'}`,
        async () => {
          const event = JSON.parse(message.content.toString('utf8')) as EventEnvelope;
          if (this.idempotency === undefined) {
            await handler(event, message.fields.routingKey);
          } else {
            await this.idempotency.handle(event.eventId, () =>
              handler(event, message.fields.routingKey),
            );
          }
        },
        {
          kind: SpanKind.CONSUMER,
          parent: extractTraceContext(message.properties.headers, ROOT_CONTEXT),
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.operation.type': 'process',
            'messaging.destination.name': this.connection.topology.queue,
            'messaging.message.id': String(message.properties.messageId ?? ''),
            'm9.event_type': eventType,
            'm9.retry_count': retryCount,
          },
        },
      );
      channel.ack(message);
      recordMessagingConsume(eventType, 'ack', startMs);
    } catch {
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
        recordMessagingPublish('retry', eventType, 'confirmed');
        channel.ack(message);
        recordMessagingConsume(eventType, 'retry', startMs);
      } else {
        // dead-letter-exchange conserva los headers originales (incluido traceparent).
        channel.nack(message, false, false);
        recordMessagingConsume(eventType, 'dead_letter', startMs);
      }
    }
  }

  private retryCount(message: ConsumeMessage): number {
    const value = message.properties.headers?.['x-retry-count'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  }
}
