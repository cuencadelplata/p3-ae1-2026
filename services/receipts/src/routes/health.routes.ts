import { Router } from 'express';

import { env } from '../config/env';
import { checkReadiness, type DependencyChecks } from '../observability/health';
import type { CircuitState } from '../resilience/circuit-breaker';

/**
 * - /health/live (vitalidad): el proceso esta vivo y atiende. No consulta
 *   dependencias, para que una caida de la base no provoque reinicios inutiles
 *   del contenedor.
 * - /health/ready (disponibilidad): informa cada dependencia. Responde 503 solo
 *   si falta una critica (PostgreSQL); si falta Redis, RabbitMQ o el
 *   autorizador fiscal responde 200 con estado degraded. Incluye ademas el
 *   estado de los circuit breakers del servicio.
 * - /health: alias de /health/ready, se conserva por compatibilidad con AE1.
 */
export function createHealthRouter(
  checks: DependencyChecks,
  circuits: () => Record<string, CircuitState> = () => ({}),
): Router {
  const router = Router();

  const info = () => ({
    service: env.serviceName,
    version: env.serviceVersion,
    uptimeSeconds: Math.round(process.uptime()),
  });

  router.get('/live', (_req, res) => {
    res.status(200).json({ status: 'ok', ...info() });
  });

  router.get(['/', '/ready'], async (_req, res, next) => {
    try {
      const readiness = await checkReadiness(checks);
      res
        .status(readiness.status === 'unavailable' ? 503 : 200)
        .json({ ...readiness, circuits: circuits(), ...info() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
