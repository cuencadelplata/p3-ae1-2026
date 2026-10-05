import type { Pool } from 'pg';
import { Viaje, type CrearViajeInput } from './Viaje.js';
import { ServiceUnavailableError } from './errors.js';

export interface ViajeRepository {
  get(id: string): Promise<Viaje | undefined>;
  save(viaje: Viaje): Promise<void>;
}

export class MapViajeRepository implements ViajeRepository {
  constructor(private readonly viajes = new Map<string, Viaje>()) {}

  async get(id: string): Promise<Viaje | undefined> {
    return this.viajes.get(id);
  }

  async save(viaje: Viaje): Promise<void> {
    this.viajes.set(viaje.id, viaje);
  }
}

export class PostgresViajeRepository implements ViajeRepository {
  private schemaPromise?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  async get(id: string): Promise<Viaje | undefined> {
    try {
      await this.ensureSchema();
      const result = await this.pool.query<{ data: CrearViajeInput & Record<string, unknown> }>(
        'SELECT data FROM viajes WHERE id = $1',
        [id],
      );
      const data = result.rows[0]?.data;
      if (!data) return undefined;

      const viaje = Object.assign(new Viaje({ ...data, inicio: new Date(String(data.inicio)) }), data);
      viaje.inicio = new Date(String(data.inicio));
      if (data.horaFin) viaje.horaFin = new Date(String(data.horaFin));
      viaje.historialTransiciones = Array.isArray(data.historialTransiciones)
        ? data.historialTransiciones.map((transicion: Record<string, unknown>) => ({
          ...transicion,
          timestamp: new Date(String(transicion.timestamp)),
        })) as Viaje['historialTransiciones']
        : [];
      return viaje;
    } catch {
      throw new ServiceUnavailableError('Base de datos no disponible');
    }
  }

  async save(viaje: Viaje): Promise<void> {
    try {
      await this.ensureSchema();
      await this.pool.query(
        'INSERT INTO viajes (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [viaje.id, JSON.stringify(viaje)],
      );
    } catch {
      throw new ServiceUnavailableError('Base de datos no disponible');
    }
  }

  private async ensureSchema(): Promise<void> {
    this.schemaPromise ??= this.pool.query(
      'CREATE TABLE IF NOT EXISTS viajes (id TEXT PRIMARY KEY, data JSONB NOT NULL)',
    ).then(() => undefined).catch((error: unknown) => {
      this.schemaPromise = undefined;
      throw error;
    });
    await this.schemaPromise;
  }
}