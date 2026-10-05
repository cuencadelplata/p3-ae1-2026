import type { InboxRecord, InboxStatus } from '../../domain/delivery.types.js';

export interface InboxRepository {
  saveOrIgnore(
    messageId: string,
    consumerId: string,
    eventType: string
  ): Promise<{ isDuplicate: boolean; record: InboxRecord }>;
  updateStatus(messageId: string, status: InboxStatus): Promise<void>;
  getRecord(messageId: string): Promise<InboxRecord | null>;
}

export class InMemoryInboxRepository implements InboxRepository {
  private records = new Map<string, InboxRecord>();

  async saveOrIgnore(
    messageId: string,
    consumerId: string,
    eventType: string
  ): Promise<{ isDuplicate: boolean; record: InboxRecord }> {
    const existing = this.records.get(messageId);
    if (existing) {
      return { isDuplicate: true, record: existing };
    }

    const newRecord: InboxRecord = {
      messageId,
      consumerId,
      eventType,
      receivedAt: new Date().toISOString(),
      status: 'RECEIVED',
    };

    this.records.set(messageId, newRecord);
    return { isDuplicate: false, record: newRecord };
  }

  async updateStatus(messageId: string, status: InboxStatus): Promise<void> {
    const record = this.records.get(messageId);
    if (record) {
      record.status = status;
      if (status === 'PROCESSED' || status === 'FAILED') {
        record.processedAt = new Date().toISOString();
      }
    }
  }

  async getRecord(messageId: string): Promise<InboxRecord | null> {
    return this.records.get(messageId) ?? null;
  }
}
