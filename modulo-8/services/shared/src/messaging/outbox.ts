import type { Channel } from 'amqplib';
import { publishWithConfirm } from './consumer';
import type { EventEnvelope } from './envelope';
import type { SqlClient } from './inbox';
import { EVENT_TYPE_TO_ROUTING_KEY, MAIN_EXCHANGE } from './topology';

export interface OutboxEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | EventEnvelope;
}

export interface OutboxStore {
  fetchPending(limit?: number): Promise<OutboxEntry[]>;
  claimPending?(limit?: number): Promise<OutboxEntry[]>;
  markAsPublished(id: string): Promise<void>;
  markAsFailed(id: string, error: string): Promise<void>;
}

/**
 * Publicador tecnico seguro de eventos Outbox hacia RabbitMQ (RF8.6).
 * Utiliza Publisher Confirms antes de confirmar el evento como publicado en la base de datos.
 * Soporta lock concurrente multi-instancia mediante claimPending (FOR UPDATE SKIP LOCKED).
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
    const entries = this.outboxStore.claimPending
      ? await this.outboxStore.claimPending(limit)
      : await this.outboxStore.fetchPending(limit);
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

/**
 * Implementacion de OutboxStore sobre PostgreSQL en la tabla messaging.outbox_events.
 * Garantiza exclusion mutua entre multiples replicas mediante FOR UPDATE SKIP LOCKED.
 */
export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly client: SqlClient) {}

  async fetchPending(limit: number = 10): Promise<OutboxEntry[]> {
    const res = await this.client.query(
      `SELECT id, event_type AS "eventType", payload FROM messaging.outbox_events
       WHERE status = 'PENDING' ORDER BY created_at LIMIT $1`,
      [limit]
    );
    return res.rows as unknown as OutboxEntry[];
  }

  async claimPending(limit: number = 10): Promise<OutboxEntry[]> {
    const res = await this.client.query(
      `UPDATE messaging.outbox_events
       SET status = 'PROCESSING', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM messaging.outbox_events
         WHERE status = 'PENDING'
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, event_type AS "eventType", payload`,
      [limit]
    );
    return res.rows as unknown as OutboxEntry[];
  }

  async markAsPublished(id: string): Promise<void> {
    await this.client.query(
      `UPDATE messaging.outbox_events SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async markAsFailed(id: string, error: string): Promise<void> {
    await this.client.query(
      `UPDATE messaging.outbox_events SET status = 'FAILED', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [id, error]
    );
  }
}
