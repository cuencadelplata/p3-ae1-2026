import type { DriverLocation, LocationHistoryEntry } from '../types/location.types.js';

export interface LocationHistoryRepository {
  save(location: DriverLocation): Promise<LocationHistoryEntry>;
  findByDriver(driverId: number, limit: number): Promise<LocationHistoryEntry[]>;
  clear(): Promise<void>;
}
