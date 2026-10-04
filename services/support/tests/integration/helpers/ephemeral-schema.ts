import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { createSupportPool } from '../../../src/db/pool.js';

// Usuario administrador local de modulo-8/compose.yaml: puede crear y borrar
// schemas. Los tests nunca tocan el schema "support" real.
export const TEST_DATABASE_URL =
  process.env.SUPPORT_TEST_DATABASE_URL ?? 'postgres://m8_admin:m8_admin_local@localhost:5432/m8';

export interface EphemeralSchema {
  schema: string;
  pool: Pool;
  // Otro pool sobre la misma base, para simular una segunda instancia.
  newPool(): Pool;
  drop(): Promise<void>;
}

// Crea un schema support_test_<aleatorio> vacío. drop() lo elimina con todo
// su contenido y cierra los pools abiertos.
export async function createEphemeralSchema(): Promise<EphemeralSchema> {
  const schema = `support_test_${randomBytes(6).toString('hex')}`;
  const pools: Pool[] = [];
  const newPool = () => {
    const pool = createSupportPool(TEST_DATABASE_URL);
    pools.push(pool);
    return pool;
  };

  const pool = newPool();
  await pool.query(`CREATE SCHEMA ${schema}`);

  return {
    schema,
    pool,
    newPool,
    async drop() {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.all(pools.map((open) => open.end()));
    },
  };
}
