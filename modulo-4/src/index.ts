import { createApp } from './app.js';
import { RedisLocationRepository } from './repositories/redis-location.repository.js';
import { LocationService } from './services/location.service.js';

const port = Number(process.env.PORT ?? 3004);
const ttlSeconds = Number(process.env.LOCATION_TTL_SECONDS ?? 60);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const repository = new RedisLocationRepository(redisUrl);
await repository.ping();
const app = createApp(new LocationService(repository, ttlSeconds), () => repository.ping());

app.listen(port, () => {
  console.log(`[M4 Ubicacion y Disponibilidad] Servicio en http://localhost:${port}`);
  console.log(`[M4] Documentacion Scalar en http://localhost:${port}/docs`);
  console.log('[M4] La interfaz grafica se ejecuta como una aplicacion independiente');
  console.log(`[M4] Ubicaciones temporales guardadas en Redis (${redisUrl})`);
});
