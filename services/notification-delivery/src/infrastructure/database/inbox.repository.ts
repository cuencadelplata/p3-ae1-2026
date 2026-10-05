import type { Pool } from 'pg';
import { PostgresTechnicalInbox } from '@m8/shared';
import type {
  InboxClaimResult,
  InboxStatus,
} from '../../domain/delivery.types.js';

export interface InboxRecord {
  consumerId: string;
  messageId: string;
  eventType: string;
  status: InboxStatus;
  leaseUntil: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessagingInboxRepository {
  claimMessage(
    consumerId: string,
    messageId: string,
    eventType: string,
    leaseSeconds?: number
  ): Promise<InboxClaimResult>;
  markProcessed(consumerId: string, messageId: string): Promise<void>;
  markFailed(consumerId: string, messageId: string): Promise<void>;
  getRecord(consumerId: string, messageId: string): Promise<InboxRecord | null>;
}

export class InMemoryMessagingInboxRepository implements MessagingInboxRepository {
  private records = new Map<string, InboxRecord>();

  private makeKey(consumerId: string, messageId: string): string {
    return `${consumerId}::${messageId}`;
  }

  async claimMessage(
    consumerId: string,
    messageId: string,
    eventType: string,
    leaseSeconds: number = 30
  ): Promise<InboxClaimResult> {
    const key = this.makeKey(consumerId, messageId);
    const existing = this.records.get(key);
    const now = Date.now();
    const leaseUntilIso = new Date(now + leaseSeconds * 1000).toISOString();

    // 1. Si no existe registro: crear reclamo atómico
    if (!existing) {
      const newRecord: InboxRecord = {
        consumerId,
        messageId,
        eventType,
        status: 'PENDING',
        leaseUntil: leaseUntilIso,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      };
      this.records.set(key, newRecord);
      return { action: 'CLAIMED', leaseUntil: leaseUntilIso };
    }

    // 2. Si ya está completado (PROCESSED): deduplicación pura -> ACK inmediato
    if (existing.status === 'PROCESSED') {
      return { action: 'ALREADY_PROCESSED' };
    }

    // 3. Si está en PENDING: verificar si el lease sigue activo o si expiró (consumidor muerto)
    if (existing.status === 'PENDING') {
      const leaseExpiresAt = Date.parse(existing.leaseUntil);
      if (now < leaseExpiresAt) {
        // Otro consumidor lo está procesando activamente
        return { action: 'LEASE_ACTIVE', leaseUntil: existing.leaseUntil };
      }

      // El lease anterior expiró: recuperar el claim huérfano
      existing.leaseUntil = leaseUntilIso;
      existing.updatedAt = new Date(now).toISOString();
      return { action: 'CLAIMED', leaseUntil: leaseUntilIso };
    }

    return { action: 'ALREADY_PROCESSED' };
  }

  async markProcessed(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    const record = this.records.get(key);
    if (record) {
      record.status = 'PROCESSED';
      record.updatedAt = new Date().toISOString();
    }
  }

  async markFailed(consumerId: string, messageId: string): Promise<void> {
    const key = this.makeKey(consumerId, messageId);
    const record = this.records.get(key);
    if (record) {
      record.status = 'FAILED';
      record.updatedAt = new Date().toISOString();
    }
  }

  async getRecord(consumerId: string, messageId: string): Promise<InboxRecord | null> {
    const key = this.makeKey(consumerId, messageId);
    return this.records.get(key) ?? null;
  }
}

export class PgMessagingInboxRepository implements MessagingInboxRepository {
  private readonly technicalInbox: PostgresTechnicalInbox;

  constructor(private readonly pool: Pool, leaseTimeoutMs = 30000) {
    this.technicalInbox = new PostgresTechnicalInbox(this.pool, leaseTimeoutMs);
  }

  async claimMessage(
    consumerId: string,
    messageId: string,
    eventType: string,
    _leaseSeconds?: number
  ): Promise<InboxClaimResult> {
    const claimed = await this.technicalInbox.claim(consumerId, messageId, eventType);
    if (claimed) {
      return { action: 'CLAIMED' };
    }

    // Si no fue reclamado, consultar el estado actual en messaging.inbox_events
    const res = await this.pool.query(
      `SELECT status, processed_at FROM messaging.inbox_events WHERE consumer_id = $1 AND message_id = $2 LIMIT 1`,
      [consumerId, messageId]
    );

    if (res.rows.length === 0) {
      return { action: 'LEASE_ACTIVE' };
    }

    const row = res.rows[0];
    if (row.status === 'PROCESSED') {
      return { action: 'ALREADY_PROCESSED' };
    }

    return {
      action: 'LEASE_ACTIVE',
      leaseUntil: new Date(row.processed_at).toISOString(),
    };
  }

  async markProcessed(consumerId: string, messageId: string): Promise<void> {
    await this.technicalInbox.markAsCompleted(consumerId, messageId);
  }

  async markFailed(consumerId: string, messageId: string): Promise<void> {
    await this.technicalInbox.releaseClaim(consumerId, messageId);
  }

  async getRecord(consumerId: string, messageId: string): Promise<InboxRecord | null> {
    const res = await this.pool.query(
      `SELECT consumer_id, message_id, event_type, status, processed_at
       FROM messaging.inbox_events
       WHERE consumer_id = $1 AND message_id = $2
       LIMIT 1`,
      [consumerId, messageId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      consumerId: row.consumer_id,
      messageId: row.message_id,
      eventType: row.event_type,
      status: row.status as InboxStatus,
      leaseUntil: new Date(row.processed_at).toISOString(),
      createdAt: new Date(row.processed_at).toISOString(),
      updatedAt: new Date(row.processed_at).toISOString(),
    };
  }
}
