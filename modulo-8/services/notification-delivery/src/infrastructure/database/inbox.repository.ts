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
