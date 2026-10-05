import type { Ticket } from '../models/ticket.model.js';
import { RabbitMQConsumer } from '../rabbitmq/consumer.js';

export type TicketEventName = 'ticket.creado' | 'ticket.actualizado';

// Publicación de los eventos de tickets. La API de tickets no depende del
// broker: publicar nunca hace fallar la operación.
export interface SupportEventPublisher {
  publish(event: TicketEventName, ticket: Ticket): Promise<void>;
}

export class NoopSupportEventPublisher implements SupportEventPublisher {
  async publish(): Promise<void> {}
}

// Publicación heredada de AE1: usa el canal del consumer legacy
// (viajes_exchange). Se retira cuando RF-8.6 extraiga el consumer.
export class LegacyRabbitSupportEventPublisher implements SupportEventPublisher {
  async publish(event: TicketEventName, ticket: Ticket): Promise<void> {
    await RabbitMQConsumer.publishEvent(event, ticket);
  }
}
