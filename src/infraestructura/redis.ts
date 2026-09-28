import { createClient } from "redis";
import { config } from "../config";

export const redis = createClient({ url: config.redisUrl });
redis.on("error", (e) => console.error("[redis]", e.message));

export async function conectarRedis(): Promise<void> {
  await redis.connect();
}

const clave = (idOrden: string) => `m7:reintegro:procesado:${idOrden}`;

export async function estaEnCache(idOrden: string): Promise<boolean> {
  try {
    return (await redis.exists(clave(idOrden))) === 1;
  } catch {
    return false;
  }
}

export async function marcarEnCache(idOrden: string): Promise<void> {
  try {
    await redis.set(clave(idOrden), "1", { EX: config.idempotenciaTtlSegundos });
  } catch {
  }
}