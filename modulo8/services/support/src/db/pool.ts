import { Pool } from 'pg';

// Tiempos cortos a propósito: con la base caída o lenta, un pedido debe fallar
// rápido en lugar de quedar colgado.
const CONNECTION_TIMEOUT_MS = 3000;
const STATEMENT_TIMEOUT_MS = 5000;

// Pool de conexiones a CommunicationsDB. allowExitOnIdle permite que el
// proceso termine cuando no quedan consultas pendientes.
export function createSupportPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 1000,
    allowExitOnIdle: true,
  });

  // Sin este listener, un error en una conexión inactiva termina el proceso.
  pool.on('error', (error) => {
    console.error('[PostgreSQL] Error en una conexión inactiva del pool:', error.message);
  });

  return pool;
}
