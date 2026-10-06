import type { DriverLocation, LocationHistoryEntry } from '../domain/entities/location.entity.js';

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
  saveRecord(record: Omit<LocationHistoryEntry, 'id' | 'recordedAt' | 'createdAt'>): Promise<void>;
  getHistoryByDriver(driverId: number, limit?: number): Promise<LocationHistoryEntry[]>;
}
