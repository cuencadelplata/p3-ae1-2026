import { createClient } from "redis";
import { config } from "../config";
import { CircuitBreaker } from "../patrones/circuitBreaker";

export const redisBreaker = new CircuitBreaker({
  nombre: "Redis",
  umbralFallos: 2,
  tiempoEsperaMs: 15000, // 15s de cooldown antes de probar en HALF-OPEN
  timeoutMs: 1500,
});

export const redis = createClient({
  url: config.redisUrl,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (reintentos) => {
      if (reintentos > 10) return new Error("Redis: límite de reintentos alcanzado");
      return Math.min(reintentos * 1000, 5000);
    },
  },
  disableOfflineQueue: true,
});

redis.on("error", (e) => {
  // Silenciamos logs repetitivos cuando ya el circuito está gestionando la caída
  if (redisBreaker.getEstado() !== "OPEN") {
    console.warn("[redis] Evento de error:", e.message);
  }
});

export async function conectarRedis(): Promise<void> {
  try {
    await redis.connect();
    console.log("[redis] Conectado exitosamente.");
  } catch (e) {
    console.warn("[redis] No se pudo conectar a Redis al inicio (se activará fallback a PostgreSQL):", (e as Error).message);
  }
}

const clave = (idOrden: string) => `m7:reintegro:procesado:${idOrden}`;

export async function estaEnCache(idOrden: string): Promise<boolean> {
  return await redisBreaker.ejecutar(
    async () => {
      const existe = await redis.exists(clave(idOrden));
      return existe === 1;
    },
    // Fallback: si el circuito está OPEN o Redis falla, asumimos false y vamos a PostgreSQL
    () => false
  );
}

export async function marcarEnCache(idOrden: string): Promise<void> {
  await redisBreaker.ejecutar(
    async () => {
      await redis.set(clave(idOrden), "1", { EX: config.idempotenciaTtlSegundos });
    },
    // Fallback: si Redis está caído, simplemente no se cachea en memoria (queda en Postgres)
    () => {}
  );
}
