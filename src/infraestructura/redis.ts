import { createClient } from "redis";
import { config } from "../config";

export const redis = createClient({
  url: config.redisUrl,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (reintentos) => {
      if (reintentos > 5) return new Error("Redis: demasiados reintentos, dejo de intentar");
      return Math.min(reintentos * 500, 3000);
    },
  },
  disableOfflineQueue: true,
});
redis.on("error", (e) => console.error("[redis]", e.message));

export async function conectarRedis(): Promise<void> {
  await redis.connect();
}

const clave = (idOrden: string) => `m7:reintegro:procesado:${idOrden}`;

// timeout manual extra, por si algún comando individual se cuelga igual
function conLimite<T>(promesa: Promise<T>, ms = 1500): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("redis timeout")), ms)),
  ]);
}

export async function estaEnCache(idOrden: string): Promise<boolean> {
  try {
    return (await conLimite(redis.exists(clave(idOrden)))) === 1;
  } catch {
    return false; // Redis caído o lento: sigue sin caché
  }
}

export async function marcarEnCache(idOrden: string): Promise<void> {
  try {
    await conLimite(redis.set(clave(idOrden), "1", { EX: config.idempotenciaTtlSegundos }));
  } catch {
  }
}