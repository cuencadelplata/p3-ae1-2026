import pg from 'pg';
import type { LocationHistoryRecord } from '../../domain/entities/location.entity.js';
import type { LocationHistoryRepository } from '../../ports/location-repository.port.js';
import { Logger } from '../logger/structured.logger.js';

export class PostgresLocationHistoryRepository implements LocationHistoryRepository {
  private pool: pg.Pool | null = null;
  private isInitialized = false;

  public constructor(private readonly connectionString: string) {
    try {
      this.pool = new pg.Pool({ connectionString });
    } catch (err) {
      Logger.warn('No se pudo instanciar la conexión con PostgreSQL', { error: err });
    }
  }

  public async saveRecord(record: LocationHistoryRecord): Promise<void> {
    if (!this.pool) return;
    try {
      await this.ensureTable();
      const query = `
        INSERT INTO location_history (driver_id, latitude, longitude, vehicle_type, available, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await this.pool.query(query, [
        record.driverId,
        record.latitude,
        record.longitude,
        record.vehicleType,
        record.available,
        record.updatedAt
      ]);
      Logger.info(`Historial de ubicación guardado en PostgreSQL para conductor ${record.driverId}`, {
        driverId: record.driverId
      });
    } catch (error) {
      Logger.error(`Error guardando historial de ubicación en PostgreSQL para ${record.driverId}`, error);
    }
  }

  public async getHistoryByDriver(driverId: number, limit = 20): Promise<LocationHistoryRecord[]> {
    if (!this.pool) return [];
    try {
      await this.ensureTable();
      const query = `
        SELECT id, driver_id as "driverId", latitude, longitude, vehicle_type as "vehicleType", available, updated_at as "updatedAt"
        FROM location_history
        WHERE driver_id = $1
        ORDER BY updated_at DESC
        LIMIT $2
      `;
      const result = await this.pool.query(query, [driverId, limit]);
      return result.rows.map((row) => ({
        id: row.id,
        driverId: Number(row.driverId),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        vehicleType: row.vehicleType,
        available: Boolean(row.available),
        updatedAt: new Date(row.updatedAt).toISOString()
      }));
    } catch (error) {
      Logger.error(`Error consultando historial de ubicaciones en PostgreSQL para ${driverId}`, error);
      return [];
    }
  }

  private async ensureTable(): Promise<void> {
    if (this.isInitialized || !this.pool) return;
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS location_history (
          id SERIAL PRIMARY KEY,
          driver_id INT NOT NULL,
          latitude DOUBLE PRECISION NOT NULL,
          longitude DOUBLE PRECISION NOT NULL,
          vehicle_type VARCHAR(10) NOT NULL,
          available BOOLEAN NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_location_history_driver ON location_history(driver_id, updated_at DESC);
      `;
      await this.pool.query(createTableQuery);
      this.isInitialized = true;
    } catch (err) {
      Logger.warn('Error asegurando tabla location_history en PostgreSQL', { error: err });
    }
  }
}
