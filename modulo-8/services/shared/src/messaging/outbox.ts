import type { Channel } from 'amqplib';
import { publishWithConfirm } from './consumer';
import type { EventEnvelope } from './envelope';
import { EVENT_TYPE_TO_ROUTING_KEY, MAIN_EXCHANGE } from './topology';

export interface OutboxEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | EventEnvelope;
}

export interface OutboxStore {
  fetchPending(limit?: number): Promise<OutboxEntry[]>;
  markAsPublished(id: string): Promise<void>;
  markAsFailed(id: string, error: string): Promise<void>;
}

/**
 * Publicador tecnico seguro de eventos Outbox hacia RabbitMQ (RF8.6).
 * Utiliza Publisher Confirms antes de confirmar el evento como publicado en la base de datos.
 */
export class OutboxPublisher {
  constructor(
    private readonly outboxStore: OutboxStore,
    private readonly exchange: string = MAIN_EXCHANGE,
    private readonly logger?: {
      info(msg: string, meta?: unknown): void;
      error(msg: string, meta?: unknown): void;
    }
  ) {}

  /**
   * Procesa la cola de eventos pendientes del Outbox y los publica en RabbitMQ con Publisher Confirms.
   */
  async publishPending(channel: Channel, limit: number = 10): Promise<number> {
    const entries = await this.outboxStore.fetchPending(limit);
    let publishedCount = 0;

    for (const entry of entries) {
      try {
        const routingKey = EVENT_TYPE_TO_ROUTING_KEY[entry.eventType] || entry.eventType.toLowerCase();
        const content = Buffer.from(JSON.stringify(entry.payload));

        await publishWithConfirm(channel, this.exchange, routingKey, content, {
          contentType: 'application/json',
          persistent: true,
          messageId: (entry.payload as EventEnvelope).messageId || entry.id,
        });

        await this.outboxStore.markAsPublished(entry.id);
        publishedCount++;
        this.logger?.info(`Outbox entry ${entry.id} (${entry.eventType}) publicado exitosamente con Publisher Confirm.`);
      } catch (err) {
        const errMsg = String((err as Error).message || err);
        await this.outboxStore.markAsFailed(entry.id, errMsg);
        this.logger?.error(`Fallo publicando Outbox entry ${entry.id}`, { error: err });
      }
    }

    return publishedCount;
  }
}
