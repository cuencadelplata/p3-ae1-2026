import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Configuración de conexión a PostgreSQL
export const dbConfig = {
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  database: process.env.DB_NAME || process.env.PGDATABASE || 'profiles',
};

export const pool = new Pool(dbConfig);

// Función para comprobar conectividad con la base de datos
export async function testDbConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error: any) {
    console.warn(`[db-profiles] Advertencia de conexión a PostgreSQL: ${error.message}`);
    return false;
  }
}
