export interface TechnicalInboxEntry {
  consumerId: string;
  messageId: string;
  eventType: string;
  status: 'PENDING' | 'PROCESSED';
  processedAt: Date;
}

/**
 * Interfaz generica para la idempotencia tecnica de mensajeria (Inbox).
 * Regla de arquitectura M8 AE2: UNIQUE(consumerId, messageId).
 * Soporta operacion atomica claim -> handler -> markAsCompleted / releaseClaim.
 */
export interface TechnicalInboxStore {
  claim(consumerId: string, messageId: string, eventType: string): Promise<boolean>;
  markAsCompleted(consumerId: string, messageId: string): Promise<void>;
  releaseClaim(consumerId: string, messageId: string): Promise<void>;
  hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean>;
  markAsProcessed(consumerId: string, messageId: string, eventType: string): Promise<void>;
}

/**
 * Implementacion en memoria de Inbox Tecnico para testing o entornos ligeros.
 */
export class InMemoryTechnicalInbox implements TechnicalInboxStore {
  private readonly entries = new Map<string, 'PENDING' | 'PROCESSED'>();

  private makeKey(consumerId: string, messageId: string): string {
    return `${consumerId}:${messageId}`;
  }

  async claim(consumerId: string, messageId: string, _eventType: string): Promise<boolean> {
    const key = this.makeKey(consumerId, messageId);
    if (this.entries.has(key)) {
      return false;
    }
    this.entries.set(key, 'PENDING');
    return true;
  }

  async markAsCompleted(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    this.entries.set(key, 'PROCESSED');
  }

  async releaseClaim(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    if (this.entries.get(key) === 'PENDING') {
      this.entries.delete(key);
    }
  }

  async hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean> {
    const status = this.entries.get(this.makeKey(consumerId, messageId));
    return status === 'PROCESSED' || status === 'PENDING';
  }

  async markAsProcessed(consumerId: string, messageId: string, _eventType: string): Promise<void> {
    this.entries.set(this.makeKey(consumerId, messageId), 'PROCESSED');
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Interfaz minima de cliente SQL para PostgresTechnicalInbox. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Implementacion de Inbox Tecnico persistido en PostgreSQL (CommunicationsDB).
 * Garantiza deduplicacion mediante restriccion UNIQUE(consumer_id, message_id) en el esquema y tabla messaging.inbox_events.
 */
export class PostgresTechnicalInbox implements TechnicalInboxStore {
  constructor(private readonly client: SqlClient) {}

  async claim(consumerId: string, messageId: string, eventType: string): Promise<boolean> {
    const res = await this.client.query(
      `INSERT INTO messaging.inbox_events (consumer_id, message_id, event_type, status, processed_at)
       VALUES ($1, $2, $3, 'PENDING', NOW())
       ON CONFLICT (consumer_id, message_id) DO NOTHING
       RETURNING 1`,
      [consumerId, messageId, eventType]
    );
    return res.rows.length > 0;
  }

  async markAsCompleted(consumerId: string, messageId: string): Promise<void> {
    await this.client.query(
      `UPDATE messaging.inbox_events
       SET status = 'PROCESSED', processed_at = NOW()
       WHERE consumer_id = $1 AND message_id = $2`,
      [consumerId, messageId]
    );
  }

  async releaseClaim(consumerId: string, messageId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM messaging.inbox_events
       WHERE consumer_id = $1 AND message_id = $2 AND status = 'PENDING'`,
      [consumerId, messageId]
    );
  }

  async hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean> {
    const res = await this.client.query(
      `SELECT 1 FROM messaging.inbox_events WHERE consumer_id = $1 AND message_id = $2 LIMIT 1`,
      [consumerId, messageId]
    );
    return res.rows.length > 0;
  }

  async markAsProcessed(consumerId: string, messageId: string, eventType: string): Promise<void> {
    await this.client.query(
      `INSERT INTO messaging.inbox_events (consumer_id, message_id, event_type, status, processed_at)
       VALUES ($1, $2, $3, 'PROCESSED', NOW())
       ON CONFLICT (consumer_id, message_id) DO UPDATE SET status = 'PROCESSED', processed_at = NOW()`,
      [consumerId, messageId, eventType]
    );
  }
}

