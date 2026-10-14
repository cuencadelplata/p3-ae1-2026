import { Pool, type PoolConfig } from 'pg';

let poolInstance: Pool | null = null;

export function buildDatabaseUrl(): string {
  if (process.env.DELIVERY_DATABASE_URL) return process.env.DELIVERY_DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.DELIVERY_DB_USER || process.env.POSTGRES_USER;
  const password = process.env.DELIVERY_DB_PASSWORD || process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || process.env.POSTGRES_HOST_PORT || '5432';
  const db = process.env.POSTGRES_DB || 'm8';

  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[RF8.7] Credenciales de base de datos no configuradas: DELIVERY_DATABASE_URL o DELIVERY_DB_PASSWORD es obligatoria en producción.'
    );
  }

  const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : '';
  return `postgres://${auth}${host}:${port}/${db}`;
}

export function getPgPool(customConfig?: PoolConfig): Pool {
  if (customConfig) {
    return new Pool({
      allowExitOnIdle: true,
      connectionTimeoutMillis: 3000,
      ...customConfig,
    });
  }

  if (!poolInstance) {
    const connectionString = buildDatabaseUrl();
    poolInstance = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 3000,
      allowExitOnIdle: true,
    });

    poolInstance.on('error', (err: Error) => {
      console.error('[RF8.7][PostgreSQL] Error in idle client:', err.message);
    });
  }

  return poolInstance;
}

export async function closePgPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end().catch(() => {});
    poolInstance = null;
  }
}

export async function isPostgresReady(pool?: Pool): Promise<boolean> {
  const target = pool ?? poolInstance;
  if (!target) return false;
  try {
    await target.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
