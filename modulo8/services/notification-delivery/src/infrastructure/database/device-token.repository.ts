import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceTokenRecord } from '../../domain/delivery.types.js';

interface StoredTokenRecord extends DeviceTokenRecord {
  seq: number;
}

export interface DeviceTokenRepository {
  upsertToken(
    userId: number,
    token: string,
    platform: 'ANDROID' | 'IOS' | 'WEB'
  ): Promise<DeviceTokenRecord>;
  deactivateToken(userId: number, token: string): Promise<boolean>;
  getActiveTokensByUserId(userId: number): Promise<DeviceTokenRecord[]>;
  getLatestActiveTokenByUserId(userId: number): Promise<DeviceTokenRecord | null>;
}

export class InMemoryDeviceTokenRepository implements DeviceTokenRepository {
  private tokens = new Map<string, StoredTokenRecord>();
  private sequence = 0;

  async upsertToken(
    userId: number,
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

  async deactivateToken(userId: number, token: string): Promise<boolean> {
    for (const record of this.tokens.values()) {
      if (record.token === token && record.userId === userId) {
        record.isActive = false;
        record.updatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  async getActiveTokensByUserId(userId: number): Promise<DeviceTokenRecord[]> {
    const list: DeviceTokenRecord[] = [];
    for (const record of this.tokens.values()) {
      if (record.userId === userId && record.isActive) {
        list.push({ ...record });
      }
    }
    return list;
  }

  async getLatestActiveTokenByUserId(userId: number): Promise<DeviceTokenRecord | null> {
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

export class PgDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly pool: Pool) {}

  async upsertToken(
    userId: number,
    token: string,
    platform: 'ANDROID' | 'IOS' | 'WEB'
  ): Promise<DeviceTokenRecord> {
    const res = await this.pool.query(
      `INSERT INTO notification_delivery.device_tokens (user_id, token, platform, is_active, updated_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT (token) DO UPDATE
         SET user_id = $1, platform = $3, is_active = true, updated_at = NOW()
       RETURNING token_id, user_id, token, platform, is_active, created_at, updated_at`,
      [userId, token, platform]
    );

    const row = res.rows[0];
    return {
      tokenId: row.token_id,
      userId: Number(row.user_id),
      token: row.token,
      platform: row.platform,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async deactivateToken(userId: number, token: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE notification_delivery.device_tokens
       SET is_active = false, updated_at = NOW()
       WHERE user_id = $1 AND token = $2`,
      [userId, token]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getActiveTokensByUserId(userId: number): Promise<DeviceTokenRecord[]> {
    const res = await this.pool.query(
      `SELECT token_id, user_id, token, platform, is_active, created_at, updated_at
       FROM notification_delivery.device_tokens
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((row: any) => ({
      tokenId: row.token_id,
      userId: Number(row.user_id),
      token: row.token,
      platform: row.platform,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async getLatestActiveTokenByUserId(userId: number): Promise<DeviceTokenRecord | null> {
    const res = await this.pool.query(
      `SELECT token_id, user_id, token, platform, is_active, created_at, updated_at
       FROM notification_delivery.device_tokens
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      tokenId: row.token_id,
      userId: Number(row.user_id),
      token: row.token,
      platform: row.platform,
      isActive: row.is_active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
