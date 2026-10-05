import { Router, Request, Response, NextFunction } from 'express';

/**
 * Modo caos compartido para todos los stubs.
 * Cada stub se registra por nombre y puede recibir un modo de fallo independiente.
 *
 * POST /__stubs/<modulo>/__chaos
 *   { "mode": "down" }       → ECONNRESET (simula servicio caído)
 *   { "delayMs": 5000 }      → respuesta lenta (prueba timeout)
 *   { "failRate": 1 }        → siempre 500 (abre circuit breaker)
 *   {}                       → vuelve a la normalidad
 */

type ChaosConfig = {
  mode?: 'down';
  delayMs?: number;
  failRate?: number;
};

const chaosState: Record<string, ChaosConfig> = {};

/**
 * Envuelve un router de stub con el middleware de caos y el endpoint de control.
 * Debe llamarse DESPUÉS de registrar las rutas del stub.
 */
export function withChaos(name: string, stubRouter: Router): Router {
  const wrapper = Router();

  // Endpoint de control: POST /__chaos
  wrapper.post('/__chaos', (req: Request, res: Response) => {
    chaosState[name] = req.body ?? {};
    res.json({ stub: name, chaos: chaosState[name] });
  });

  // Middleware de caos antes de las rutas reales
  wrapper.use((req: Request, res: Response, next: NextFunction) => {
    const cfg = chaosState[name];
    if (!cfg) {
      next();
      return;
    }

    if (cfg.mode === 'down') {
      // Simula un ECONNRESET: destruir el socket sin respuesta
      req.socket.destroy();
      return;
    }

    if (typeof cfg.failRate === 'number' && cfg.failRate > 0 && Math.random() < cfg.failRate) {
      res.status(500).json({ error: 'ChaosError', message: `[stub:${name}] Error inyectado por modo caos` });
      return;
    }

    if (typeof cfg.delayMs === 'number' && cfg.delayMs > 0) {
      setTimeout(next, cfg.delayMs);
      return;
    }

    next();
  });

  // Montar el router real del stub
  wrapper.use('/', stubRouter);

  return wrapper;
}
