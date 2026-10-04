import type { RabbitMqConnection } from '../infrastructure/rabbitmq/rabbitmq.connection.js';
import type { EventEnvelope } from './event-envelope.js';
import type { EventPublisher } from './event-publisher.js';

export class RabbitMqEventPublisher implements EventPublisher {
  public constructor(private readonly connection: RabbitMqConnection) {}

  public async publish(routingKey: string, event: EventEnvelope): Promise<void> {
    await this.publishAt(this.connection.topology.exchange, routingKey, event);
  }

  public async publishToDeadLetter(routingKey: string, event: EventEnvelope): Promise<void> {
    await this.publishAt(this.connection.topology.deadLetterExchange, routingKey, event);
  }

  private async publishAt(
    exchange: string,
    routingKey: string,
    event: EventEnvelope,
  ): Promise<void> {
    const channel = this.connection.getChannel();
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      correlationId: event.correlationId,
      type: event.eventType,
      timestamp: Date.parse(event.occurredAt),
    });
    await channel.waitForConfirms();
  }
}
