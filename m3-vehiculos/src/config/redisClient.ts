import { createClient, type RedisClientType } from "redis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("Falta REDIS_URL en las variables de entorno");
}

export const redis: RedisClientType = createClient({ url: redisUrl });

redis.on("error", (err) => {
  console.error("[redis] Error de conexión:", err);
});