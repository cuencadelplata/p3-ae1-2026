import type { DriverLocation, LocationHistoryRecord } from '../domain/entities/location.entity.js';

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
  ping?(): Promise<void>;
}

export interface LocationHistoryRepository {
  saveRecord(record: LocationHistoryRecord): Promise<void>;
  getHistoryByDriver(driverId: number, limit?: number): Promise<LocationHistoryRecord[]>;
}
