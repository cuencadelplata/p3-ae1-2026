import { createViajeApi, HttpExternalApisClient } from './src/api.js';
import { Pool } from 'pg';
import { PostgresViajeRepository } from './src/ViajeRepository.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
  query_timeout: 2500,
});
pool.on('error', (error) => console.error('Error en conexión PostgreSQL inactiva:', error.message));

const server = createViajeApi({
  externalApis: new HttpExternalApisClient(
    process.env.M7_URL ?? process.env.SIMULATOR_URL ?? 'http://127.0.0.1:3001',
    process.env.M4_URL ?? `${process.env.SIMULATOR_URL ?? 'http://127.0.0.1:3001'}/api/v1`,
  ),
  repository: new PostgresViajeRepository(pool),
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log(`API M6 escuchando en ${process.env.PORT ?? 3000}`);
});