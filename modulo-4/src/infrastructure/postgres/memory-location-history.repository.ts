import type { LocationHistoryRecord } from '../../domain/entities/location.entity.js';
import type { LocationHistoryRepository } from '../../ports/location-repository.port.js';

export class MemoryLocationHistoryRepository implements LocationHistoryRepository {
  private readonly records: LocationHistoryRecord[] = [];

  public async saveRecord(record: LocationHistoryRecord): Promise<void> {
    this.records.push({ ...record, id: this.records.length + 1 });
  }

  public async getHistoryByDriver(driverId: number, limit = 20): Promise<LocationHistoryRecord[]> {
    return this.records
      .filter((rec) => rec.driverId === driverId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }
}
