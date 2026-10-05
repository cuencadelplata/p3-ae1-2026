import { createApp } from './app.js';
import { RedisLocationRepository } from './repositories/redis-location.repository.js';
import { LocationService } from './services/location.service.js';
import { PostgresLocationHistoryRepository } from './repositories/postgres-location-history.repository.js';
import { M1IdentityClient } from './auth/m1-identity.client.js';

const port = Number(process.env.PORT ?? 3004);
const ttlSeconds = Number(process.env.LOCATION_TTL_SECONDS ?? 60);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://m4_user:m4_password@127.0.0.1:5432/m4_locations';
const m1Url = process.env.M1_URL ?? 'http://localhost:3001';
const repository = new RedisLocationRepository(redisUrl);
const historyRepository = new PostgresLocationHistoryRepository(databaseUrl);
const identityClient = new M1IdentityClient(m1Url);
await repository.ping();
await historyRepository.initialize();
const app = createApp(
  new LocationService(repository, ttlSeconds, Date.now, historyRepository),
  async () => {
    await Promise.all([repository.ping(), historyRepository.ping()]);
  },
  identityClient
);

app.listen(port, () => {
  console.log(`[M4 Ubicacion y Disponibilidad] Servicio en http://localhost:${port}`);
  console.log(`[M4] Documentacion Scalar en http://localhost:${port}/docs`);
  console.log('[M4] La interfaz grafica se ejecuta como una aplicacion independiente');
  console.log(`[M4] Ubicaciones temporales guardadas en Redis (${redisUrl})`);
  console.log('[M4] Historial permanente guardado en PostgreSQL');
  console.log(`[M4] Validacion de conductores mediante M1 (${m1Url})`);
});
