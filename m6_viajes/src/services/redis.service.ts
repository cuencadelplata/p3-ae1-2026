import { Redis } from 'ioredis';

// Conectamos a la instancia de Redis que levantamos en tu Docker
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new Redis(REDIS_URL);

redisClient.on('connect', () => {
    console.log('[Redis] Conexión exitosa a la caché');
});

redisClient.on('error', (err) => {
    console.error('[Redis] Error de conexión:', err);
});