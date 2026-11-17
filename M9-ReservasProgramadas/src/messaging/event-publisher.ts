import type { EventEnvelope } from './event-envelope.js';

export interface EventPublisher {
  publish(routingKey: string, event: EventEnvelope): Promise<void>;
  publishToDeadLetter(routingKey: string, event: EventEnvelope): Promise<void>;
}
