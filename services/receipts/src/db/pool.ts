import { Pool } from 'pg';

import { env } from '../config/env';

/**
 * Pool unico de conexiones a CommunicationsDB. allowExitOnIdle permite que el
 * proceso termine cuando no quedan consultas pendientes, algo necesario para
 * que las pruebas finalicen sin cerrar el pool a mano.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: true,
});

pool.on('error', (error) => {
  console.error(`[${env.serviceName}] error en una conexion inactiva del pool`, error);
});

export async function isDatabaseReady(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function closePool(): Promise<void> {
  return pool.end();
}
