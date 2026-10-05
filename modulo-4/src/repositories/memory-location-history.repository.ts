import type { DriverLocation, LocationHistoryEntry } from '../types/location.types.js';
import type { LocationHistoryRepository } from './location-history.repository.js';

export class MemoryLocationHistoryRepository implements LocationHistoryRepository {
  private entries: LocationHistoryEntry[] = [];
  private nextId = 1;

  public async save(location: DriverLocation): Promise<LocationHistoryEntry> {
    const existing = this.entries.find(
      (entry) => entry.driverId === location.driverId && entry.recordedAt === location.updatedAt
    );
    if (existing) {
      existing.latitude = location.latitude;
      existing.longitude = location.longitude;
      existing.vehicleType = location.vehicleType;
      existing.available = location.available;
      return existing;
    }
    const entry: LocationHistoryEntry = {
      id: this.nextId,
      driverId: location.driverId,
      latitude: location.latitude,
      longitude: location.longitude,
      vehicleType: location.vehicleType,
      available: location.available,
      updatedAt: location.updatedAt,
      recordedAt: location.updatedAt,
      createdAt: new Date().toISOString()
    };
    this.nextId += 1;
    this.entries.push(entry);
    return entry;
  }

  public async findByDriver(driverId: string, limit: number): Promise<LocationHistoryEntry[]> {
    return this.entries
      .filter((entry) => entry.driverId === driverId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit);
  }

  public async clear(): Promise<void> {
    this.entries = [];
    this.nextId = 1;
  }
}
