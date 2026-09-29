import type { DriverLocation } from '../types/location.types.js';
import type { LocationRepository, SaveLocationResult } from './location.repository.js';

interface StoredLocation {
  location: DriverLocation;
  expiresAtMs: number;
}

export class MemoryLocationRepository implements LocationRepository {
  private readonly locations = new Map<string, StoredLocation>();

  public constructor(private readonly now: () => number = Date.now) {}

  public async saveIfNewer(
    location: DriverLocation,
    ttlSeconds: number
  ): Promise<SaveLocationResult> {
    const stored = this.locations.get(location.driverId);
    const current = stored && stored.expiresAtMs > this.now() ? stored.location : null;
    if (current && Date.parse(location.updatedAt) < Date.parse(current.updatedAt)) {
      return { saved: false, location: current };
    }

    this.locations.set(location.driverId, {
      location,
      expiresAtMs: this.now() + ttlSeconds * 1000
    });
    return { saved: true, location };
  }

  public async get(driverId: string): Promise<DriverLocation | null> {
    const stored = this.locations.get(driverId);
    if (!stored) return null;
    if (stored.expiresAtMs <= this.now()) {
      this.locations.delete(driverId);
      return null;
    }
    return stored.location;
  }

  public async getAll(): Promise<DriverLocation[]> {
    const active: DriverLocation[] = [];
    for (const driverId of this.locations.keys()) {
      const location = await this.get(driverId);
      if (location) active.push(location);
    }
    return active;
  }

  public async delete(driverId: string): Promise<boolean> {
    const exists = (await this.get(driverId)) !== null;
    if (exists) this.locations.delete(driverId);
    return exists;
  }

  public async clear(): Promise<void> {
    this.locations.clear();
  }
}
