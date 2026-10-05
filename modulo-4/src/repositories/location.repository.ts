import type { DriverLocation } from '../types/location.types.js';

export interface SaveLocationResult {
  saved: boolean;
  location: DriverLocation;
}

export interface LocationRepository {
  saveIfNewer(location: DriverLocation, ttlSeconds: number): Promise<SaveLocationResult>;
  get(driverId: number): Promise<DriverLocation | null>;
  getAll(): Promise<DriverLocation[]>;
  delete(driverId: number): Promise<boolean>;
  clear(): Promise<void>;
}
