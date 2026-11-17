import type { RabbitMqConnection } from '../infrastructure/rabbitmq/rabbitmq.connection.js';
import { recordMessagingPublish } from '../observability/metrics.js';
import { injectTraceContext } from '../observability/tracing.js';
import type { EventEnvelope } from './event-envelope.js';
import type { EventPublisher } from './event-publisher.js';

export class RabbitMqEventPublisher implements EventPublisher {
  public constructor(private readonly connection: RabbitMqConnection) {}

  public async publish(routingKey: string, event: EventEnvelope): Promise<void> {
    await this.publishAt(this.connection.topology.exchange, routingKey, event, 'main');
  }

  public async publishToDeadLetter(routingKey: string, event: EventEnvelope): Promise<void> {
    await this.publishAt(
      this.connection.topology.deadLetterExchange,
      routingKey,
      event,
      'dead_letter',
    );
  }

  private async publishAt(
    exchange: string,
    routingKey: string,
    event: EventEnvelope,
    destination: 'main' | 'dead_letter',
  ): Promise<void> {
    try {
      const channel = this.connection.getChannel();
      channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        correlationId: event.correlationId,
        type: event.eventType,
        timestamp: Date.parse(event.occurredAt),
        // Propagación W3C: el consumidor continúa la traza del span de publicación activo.
        headers: injectTraceContext(),
      });
      await channel.waitForConfirms();
      recordMessagingPublish(destination, event.eventType, 'confirmed');
    } catch (error) {
      recordMessagingPublish(destination, event.eventType, 'error');
      throw error;
    }
  }
}
