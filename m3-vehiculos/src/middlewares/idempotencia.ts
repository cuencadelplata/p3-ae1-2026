import type { Request, Response, NextFunction } from "express";
import { redis } from "../config/redisClient.js";

// TTL de la clave de idempotencia en Redis: 24 horas.
const TTL_SEGUNDOS = 60 * 60 * 24;

/**
 * Middleware de idempotencia para POST.
 *
 * Si el cliente manda el header "Idempotency-Key":
 *  - si esa key ya está en Redis, devuelve la respuesta cacheada
 *    (mismo status, mismo body) SIN volver a ejecutar el handler.
 *  - si no está, deja pasar la request y, cuando el handler responde
 *    con un 2xx, guarda esa respuesta en Redis asociada a la key.
 *
 * Si el cliente NO manda el header, no hace nada (next() directo):
 * la idempotencia es opcional, no rompe clientes que no la usan.
 */
export async function idempotencia(req: Request, res: Response, next: NextFunction) {
  const key = req.header("Idempotency-Key");

  if (!key) {
    return next();
  }

  const redisKey = `idempotency:${key}`;

  try {
    const cacheado = await redis.get(redisKey);

    if (cacheado) {
      const { status, body } = JSON.parse(cacheado);
      return res.status(status).json(body);
    }
  } catch (err) {
    // Si Redis falla, no bloqueamos el pedido: seguimos sin idempotencia
    // antes que devolver un 500 por algo que no depende del cliente.
    console.error("[idempotencia] Error leyendo Redis:", err);
    return next();
  }

  // Interceptamos res.json para guardar la respuesta ANTES de enviarla.
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      redis
        .set(redisKey, JSON.stringify({ status: res.statusCode, body }), {
          EX: TTL_SEGUNDOS,
        })
        .catch((err) => {
          console.error("[idempotencia] Error guardando en Redis:", err);
        });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}