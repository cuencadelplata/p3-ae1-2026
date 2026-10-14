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

interface InMemoryEntry {
  status: 'PENDING' | 'PROCESSED';
  claimedAt: number;
}

/**
 * Implementacion en memoria de Inbox Tecnico para testing o entornos ligeros.
 * Soporta recuperacion de claims PENDING viejos tras pendingTimeoutMs.
 */
export class InMemoryTechnicalInbox implements TechnicalInboxStore {
  private readonly entries = new Map<string, InMemoryEntry>();

  constructor(private readonly pendingTimeoutMs: number = 300000) {}

  private makeKey(consumerId: string, messageId: string): string {
    return `${consumerId}:${messageId}`;
  }

  async claim(consumerId: string, messageId: string, _eventType: string): Promise<boolean> {
    const key = this.makeKey(consumerId, messageId);
    const existing = this.entries.get(key);
    const now = Date.now();

    if (existing) {
      if (existing.status === 'PROCESSED') {
        return false;
      }
      if (existing.status === 'PENDING') {
        const isExpired = now - existing.claimedAt > this.pendingTimeoutMs;
        if (!isExpired) {
          return false;
        }
      }
    }

    this.entries.set(key, { status: 'PENDING', claimedAt: now });
    return true;
  }

  async markAsCompleted(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    this.entries.set(key, { status: 'PROCESSED', claimedAt: Date.now() });
  }

  async releaseClaim(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    const entry = this.entries.get(key);
    if (entry && entry.status === 'PENDING') {
      this.entries.delete(key);
    }
  }

  async hasBeenProcessed(consumerId: string, messageId: string): Promise<boolean> {
    const entry = this.entries.get(this.makeKey(consumerId, messageId));
    if (!entry) return false;
    if (entry.status === 'PROCESSED') return true;
    const isExpired = Date.now() - entry.claimedAt > this.pendingTimeoutMs;
    return !isExpired;
  }

  async markAsProcessed(consumerId: string, messageId: string, _eventType: string): Promise<void> {
    this.entries.set(this.makeKey(consumerId, messageId), { status: 'PROCESSED', claimedAt: Date.now() });
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
 * Soporta recuperacion de claims PENDING viejos/abandonados (lease timeout).
 */
export class PostgresTechnicalInbox implements TechnicalInboxStore {
  constructor(
    private readonly client: SqlClient,
    private readonly pendingTimeoutMs: number = 300000
  ) {}

  async claim(consumerId: string, messageId: string, eventType: string): Promise<boolean> {
    const timeoutSeconds = Math.max(1, Math.ceil(this.pendingTimeoutMs / 1000));
    const res = await this.client.query(
      `INSERT INTO messaging.inbox_events (consumer_id, message_id, event_type, status, processed_at)
       VALUES ($1, $2, $3, 'PENDING', NOW())
       ON CONFLICT (consumer_id, message_id) DO UPDATE
         SET status = 'PENDING', processed_at = NOW(), event_type = $3
         WHERE messaging.inbox_events.status = 'PENDING'
           AND messaging.inbox_events.processed_at < NOW() - ($4 || ' seconds')::INTERVAL
       RETURNING 1`,
      [consumerId, messageId, eventType, timeoutSeconds]
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
