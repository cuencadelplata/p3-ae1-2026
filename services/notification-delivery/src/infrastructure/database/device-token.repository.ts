import { randomUUID } from 'node:crypto';
import type { DeviceTokenRecord } from '../../domain/delivery.types.js';

interface StoredTokenRecord extends DeviceTokenRecord {
  seq: number;
}

export interface DeviceTokenRepository {
  upsertToken(
    userId: string,
    token: string,
    platform: 'ANDROID' | 'IOS' | 'WEB'
  ): Promise<DeviceTokenRecord>;
  deactivateToken(userId: string, token: string): Promise<boolean>;
  getActiveTokensByUserId(userId: string): Promise<DeviceTokenRecord[]>;
  getLatestActiveTokenByUserId(userId: string): Promise<DeviceTokenRecord | null>;
}

export class InMemoryDeviceTokenRepository implements DeviceTokenRepository {
  private tokens = new Map<string, StoredTokenRecord>();
  private sequence = 0;

  async upsertToken(
    userId: string,
    token: string,
    platform: 'ANDROID' | 'IOS' | 'WEB'
  ): Promise<DeviceTokenRecord> {
    const now = new Date().toISOString();
    this.sequence += 1;

    for (const record of this.tokens.values()) {
      if (record.token === token) {
        record.userId = userId;
        record.platform = platform;
        record.isActive = true;
        record.updatedAt = now;
        record.seq = this.sequence;
        return { ...record };
      }
    }

    const newRecord: StoredTokenRecord = {
      tokenId: randomUUID(),
      userId,
      token,
      platform,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      seq: this.sequence,
    };

    this.tokens.set(newRecord.tokenId, newRecord);
    return { ...newRecord };
  }

  async deactivateToken(userId: string, token: string): Promise<boolean> {
    for (const record of this.tokens.values()) {
      if (record.token === token && record.userId === userId) {
        record.isActive = false;
        record.updatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  async getActiveTokensByUserId(userId: string): Promise<DeviceTokenRecord[]> {
    const list: DeviceTokenRecord[] = [];
    for (const record of this.tokens.values()) {
      if (record.userId === userId && record.isActive) {
        list.push({ ...record });
      }
    }
    return list;
  }

  async getLatestActiveTokenByUserId(userId: string): Promise<DeviceTokenRecord | null> {
    const active: StoredTokenRecord[] = [];
    for (const record of this.tokens.values()) {
      if (record.userId === userId && record.isActive) {
        active.push({ ...record });
      }
    }
    if (active.length === 0) return null;

    active.sort((a, b) => {
      const timeDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      if (timeDiff !== 0) return timeDiff;
      return b.seq - a.seq;
    });

    return active[0] ?? null;
  }
}
