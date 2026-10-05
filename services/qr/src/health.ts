import { Router } from "express";

// Comprobación de una dependencia: true si está disponible. Si rechaza, cuenta como no
// disponible.
export type DependencyCheck = () => Promise<boolean>;

export const HEALTH_CHECK_TIMEOUT_MS = 2000;

const SERVICE_NAME = "qr";

// Una comprobación que no responde dentro del tope cuenta como no disponible.
export async function probeWithTimeout(check: DependencyCheck, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([check().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// - /health/live (vitalidad): el proceso responde. No consulta Redis, para que una caída de
//   Redis no provoque reinicios innecesarios del contenedor.
// - /health/ready (disponibilidad): Redis es crítico; sin Redis responde 503.
// - /health: alias de /health/ready, conservado por compatibilidad con AE1.
export function createHealthRouter(checkRedis: DependencyCheck): Router {
  const router = Router();

  router.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok", service: SERVICE_NAME });
  });

  router.get(["/health/ready", "/health"], async (_request, response) => {
    const redisAvailable = await probeWithTimeout(checkRedis, HEALTH_CHECK_TIMEOUT_MS);

    response.status(redisAvailable ? 200 : 503).json({
      status: redisAvailable ? "ok" : "unavailable",
      service: SERVICE_NAME,
      dependencies: { redis: { status: redisAvailable ? "available" : "unavailable" } },
    });
  });

  return router;
}
