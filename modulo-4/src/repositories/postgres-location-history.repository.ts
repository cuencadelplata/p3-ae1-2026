import { Pool } from 'pg';
import type { DriverLocation, LocationHistoryEntry, VehicleType } from '../types/location.types.js';
import type { LocationHistoryRepository } from './location-history.repository.js';

interface HistoryRow {
  id: string;
  driver_id: string;
  latitude: number;
  longitude: number;
  vehicle_type: VehicleType;
  available: boolean;
  recorded_at: Date;
  created_at: Date;
}

export class PostgresLocationHistoryRepository implements LocationHistoryRepository {
  private readonly pool: Pool;

  public constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  public async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS driver_location_history (
        id BIGSERIAL PRIMARY KEY,
        driver_id VARCHAR(100) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        vehicle_type VARCHAR(10) NOT NULL CHECK (vehicle_type IN ('AUTO', 'MOTO')),
        available BOOLEAN NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_driver_location_history_driver_recorded
        ON driver_location_history (driver_id, recorded_at DESC)
    `);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_location_history_idempotency
        ON driver_location_history (driver_id, recorded_at)
    `);
  }

  public async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  public async save(location: DriverLocation): Promise<LocationHistoryEntry> {
    const result = await this.pool.query<HistoryRow>(
      `INSERT INTO driver_location_history
        (driver_id, latitude, longitude, vehicle_type, available, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (driver_id, recorded_at) DO UPDATE SET
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         vehicle_type = EXCLUDED.vehicle_type,
         available = EXCLUDED.available
       RETURNING id, driver_id, latitude, longitude, vehicle_type, available, recorded_at, created_at`,
      [
        location.driverId,
        location.latitude,
        location.longitude,
        location.vehicleType,
        location.available,
        location.updatedAt
      ]
    );
    return this.toEntry(result.rows[0]);
  }

  public async findByDriver(driverId: string, limit: number): Promise<LocationHistoryEntry[]> {
    const result = await this.pool.query<HistoryRow>(
      `SELECT id, driver_id, latitude, longitude, vehicle_type, available, recorded_at, created_at
       FROM driver_location_history
       WHERE driver_id = $1
       ORDER BY recorded_at DESC, id DESC
       LIMIT $2`,
      [driverId, limit]
    );
    return result.rows.map((row) => this.toEntry(row));
  }

  public async clear(): Promise<void> {
    await this.pool.query('TRUNCATE driver_location_history RESTART IDENTITY');
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private toEntry(row: HistoryRow): LocationHistoryEntry {
    return {
      id: Number(row.id),
      driverId: row.driver_id,
      latitude: row.latitude,
      longitude: row.longitude,
      vehicleType: row.vehicle_type,
      available: row.available,
      updatedAt: row.recorded_at.toISOString(),
      recordedAt: row.recorded_at.toISOString(),
      createdAt: row.created_at.toISOString()
    };
  }
}
