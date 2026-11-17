import type { LocationHistoryEntry } from '../../domain/entities/location.entity.js';
import type { LocationHistoryRepository } from '../../ports/location-repository.port.js';

export class MemoryLocationHistoryRepository implements LocationHistoryRepository {
  private readonly records: LocationHistoryEntry[] = [];

  public async saveRecord(record: Omit<LocationHistoryEntry, 'id' | 'recordedAt' | 'createdAt'>): Promise<void> {
    const nowIso = new Date().toISOString();
    this.records.push({
      ...record,
      id: this.records.length + 1,
      recordedAt: record.updatedAt || nowIso,
      createdAt: nowIso
    });
  }

  public async getHistoryByDriver(driverId: number, limit = 20): Promise<LocationHistoryEntry[]> {
    return this.records
      .filter((rec) => rec.driverId === driverId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }
}
