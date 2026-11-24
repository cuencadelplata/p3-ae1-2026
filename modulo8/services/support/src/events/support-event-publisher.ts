import type { Ticket } from '../models/ticket.model.js';

export type TicketEventName = 'ticket.creado' | 'ticket.actualizado';

// Publicación de los eventos de tickets. La API de tickets no depende del
// broker: publicar nunca hace fallar la operación.
export interface SupportEventPublisher {
  publish(event: TicketEventName, ticket: Ticket): Promise<void>;
}

export class NoopSupportEventPublisher implements SupportEventPublisher {
  async publish(): Promise<void> {}
}
