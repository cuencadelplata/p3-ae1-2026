import { createClient, type RedisClientType } from "redis";

// si falta REDIS_URL; la validación se hace al momento de conectar.
export const redis: RedisClientType = createClient({ url: process.env.REDIS_URL });

redis.on("error", (err) => {
  console.error("[redis] Error de conexión:", err);
});

export async function connectRedis(): Promise<void> {
  if (!process.env.REDIS_URL) {
    throw new Error("Falta REDIS_URL en las variables de entorno");
  }
  await redis.connect();
}
