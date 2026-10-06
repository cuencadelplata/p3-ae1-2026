import type { DriverLocation } from '../../domain/entities/location.entity.js';
import type { LocationRepository, SaveLocationResult } from '../../ports/location-repository.port.js';

export class MemoryLocationRepository implements LocationRepository {
  private readonly locations = new Map<number, DriverLocation>();

  public async ping(): Promise<void> {
    return Promise.resolve();
  }

  public async saveIfNewer(
    location: DriverLocation,
    _ttlSeconds: number
  ): Promise<SaveLocationResult> {
    const current = this.locations.get(location.driverId);
    if (current && Date.parse(location.updatedAt) < Date.parse(current.updatedAt)) {
      return { saved: false, location: current };
    }
    this.locations.set(location.driverId, location);
    return { saved: true, location };
  }

  public async get(driverId: number): Promise<DriverLocation | null> {
    const location = this.locations.get(driverId);
    if (!location) return null;
    if (new Date(location.expiresAt).getTime() <= Date.now()) {
      this.locations.delete(driverId);
      return null;
    }
    return location;
  }

  public async getAll(): Promise<DriverLocation[]> {
    const now = Date.now();
    const activeLocations: DriverLocation[] = [];

    for (const [driverId, location] of this.locations.entries()) {
      if (new Date(location.expiresAt).getTime() <= now) {
        this.locations.delete(driverId);
      } else {
        activeLocations.push(location);
      }
    }

    return activeLocations;
  }

  public async delete(driverId: number): Promise<boolean> {
    return this.locations.delete(driverId);
  }

  public async clear(): Promise<void> {
    this.locations.clear();
  }
}
