import type { Request, RequestHandler } from 'express';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { CircuitStatus, DependencyName } from '../resilience/policies.js';

const CIRCUIT_STATES = ['closed', 'open', 'half_open', 'isolated'] as const;

export type CacheOperation = 'get' | 'set' | 'invalidate';
export type CacheOutcome = 'hit' | 'miss' | 'success' | 'error';

export const metricsRegistry = new Registry();

const httpRequests = new Counter({
  name: 'm2_http_requests_total',
  help: 'Total de solicitudes HTTP del módulo M2',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry]
});

const httpRequestDuration = new Histogram({
  name: 'm2_http_request_duration_seconds',
  help: 'Duración de solicitudes HTTP del módulo M2',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry]
});

const cacheOperations = new Counter({
  name: 'm2_cache_operations_total',
  help: 'Operaciones de caché de perfiles por resultado',
  labelNames: ['operation', 'outcome'],
  registers: [metricsRegistry]
});

const circuitState = new Gauge({
  name: 'm2_circuit_state',
  help: 'Estado one-hot de cada circuit breaker',
  labelNames: ['dependency', 'state'],
  registers: [metricsRegistry]
});

function routeLabel(req: Request): string {
  const routePath: unknown = req.route?.path;
  return typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : 'unmatched';
}

export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
  const stopTimer = httpRequestDuration.startTimer();
  res.once('finish', () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode)
    };
    httpRequests.inc(labels);
    stopTimer(labels);
  });
  next();
};

export function recordCacheOperation(operation: CacheOperation, outcome: CacheOutcome): void {
  cacheOperations.inc({ operation, outcome });
}

export function recordCircuitState(dependency: DependencyName, current: CircuitStatus): void {
  for (const state of CIRCUIT_STATES) {
    circuitState.set({ dependency, state }, state === current ? 1 : 0);
  }
}

export const metricsHandler: RequestHandler = (_req, res, next) => {
  metricsRegistry.metrics().then((body) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.status(200).send(body);
  }).catch(next);
};
