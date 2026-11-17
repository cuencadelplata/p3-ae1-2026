import pg from 'pg';
import dotenv from 'dotenv';
import { describeError } from '../errors/service-unavailable.error.js';

dotenv.config();

const { Pool } = pg;

// Lee un entero de una variable de entorno, con valor por defecto
function intFromEnv(name: string, fallback: number): number {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(value) ? fallback : value;
}

// Configuración de conexión a PostgreSQL
export const dbConfig = {
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  database: process.env.DB_NAME || process.env.PGDATABASE || 'profiles',
};

// Timeouts explícitos (C5): si la DB no responde, se corta rápido en vez de colgar la request
export const dbTimeouts = {
  // Máximo para obtener una conexión del pool (incluye abrir una nueva)
  connectionTimeoutMillis: intFromEnv('DB_CONNECTION_TIMEOUT_MS', 2000),
  // Máximo que el cliente espera la respuesta de una query (cubre cortes de red)
  query_timeout: intFromEnv('DB_QUERY_TIMEOUT_MS', 3000),
  // Postgres cancela del lado del servidor las queries que superen este tiempo
  statement_timeout: intFromEnv('DB_STATEMENT_TIMEOUT_MS', 3000),
  // Cierra conexiones inactivas para no retener conexiones muertas
  idleTimeoutMillis: intFromEnv('DB_IDLE_TIMEOUT_MS', 30000),
};

export const pool = new Pool({ ...dbConfig, ...dbTimeouts });

// Si la DB se cae, los clientes inactivos del pool emiten 'error'.
// Sin este listener, Node lanza el evento como excepción y el proceso se cae.
pool.on('error', (error) => {
  console.error(`[db-profiles] Error en una conexión inactiva del pool: ${describeError(error)}`);
});

// Función para comprobar conectividad con la base de datos
export async function testDbConnection(): Promise<boolean> {
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    return true;
  } catch (error: any) {
    console.warn(`[db-profiles] Advertencia de conexión a PostgreSQL: ${describeError(error)}`);
    return false;
  } finally {
    client?.release();
  }
}
