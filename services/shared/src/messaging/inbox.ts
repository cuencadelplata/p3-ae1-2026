export interface TechnicalInboxEntry {
  consumerId: string;
  messageId: string;
  eventType: string;
  processedAt: Date;
}

/**
 * Interfaz genérica para la idempotencia técnica de mensajería (Inbox).
 * Regla de arquitectura M8 AE2: UNIQUE(consumerId, messageId).
 */
export interface TechnicalInboxStore {
  hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean>;
  markAsProcessed(consumerId: string, messageId: string, eventType: string): Promise<void>;
}

/**
 * Implementacion en memoria de Inbox Tecnico para testing o entornos ligeros.
 */
export class InMemoryTechnicalInbox implements TechnicalInboxStore {
  private readonly processed = new Set<string>();

  private makeKey(consumerId: string, messageId: string): string {
    return `${consumerId}:${messageId}`;
  }

  async hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean> {
    return this.processed.has(this.makeKey(consumerId, messageId));
  }

  async markAsProcessed(consumerId: string, messageId: string, eventType: string): Promise<void> {
    this.processed.add(this.makeKey(consumerId, messageId));
  }

  clear(): void {
    this.processed.clear();
  }
}

/** Interfaz minima de cliente SQL para PostgresTechnicalInbox. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Implementacion de Inbox Tecnico persistido en PostgreSQL (CommunicationsDB).
 * Garantiza deduplicacion mediante restriccion UNIQUE(consumer_id, message_id).
 */
export class PostgresTechnicalInbox implements TechnicalInboxStore {
  constructor(private readonly client: SqlClient) {}

  async hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean> {
    const res = await this.client.query(
      `SELECT 1 FROM technical_inbox WHERE consumer_id = $1 AND message_id = $2 LIMIT 1`,
      [consumerId, messageId]
    );
    return res.rows.length > 0;
  }

  async markAsProcessed(consumerId: string, messageId: string, eventType: string): Promise<void> {
    await this.client.query(
      `INSERT INTO technical_inbox (consumer_id, message_id, event_type, processed_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (consumer_id, message_id) DO NOTHING`,
      [consumerId, messageId, eventType]
    );
  }
}
