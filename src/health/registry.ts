import type { RequestHandler } from 'express';
import { pool } from '../config/db.js';
import { testRedisConnection } from '../config/redis.js';
import { getCircuitStates, type CircuitStates } from '../resilience/policies.js';

export type HealthCheck = () => Promise<boolean>;
export type HealthStatus = 'UP' | 'DEGRADED';

type CheckResult = {
  readonly status: 'UP' | 'DOWN';
  readonly responseTimeMs: number;
};

export type HealthSnapshot = {
  readonly status: HealthStatus;
  readonly service: 'm2-clientes-api';
  readonly checks: Readonly<Record<string, CheckResult>>;
  readonly circuits: CircuitStates;
};

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  constructor(private readonly circuitStates: () => CircuitStates = getCircuitStates) {}

  register(name: string, check: HealthCheck): () => void {
    this.checks.set(name, check);
    return () => {
      if (this.checks.get(name) === check) this.checks.delete(name);
    };
  }

  async snapshot(): Promise<HealthSnapshot> {
    const entries = await Promise.all([...this.checks.entries()].map(async ([name, check]) => {
      const startedAt = performance.now();
      try {
        const healthy = await check();
        return [name, {
          status: healthy ? 'UP' : 'DOWN',
          responseTimeMs: Number((performance.now() - startedAt).toFixed(2))
        }] as const;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return [name, {
          status: 'DOWN',
          responseTimeMs: Number((performance.now() - startedAt).toFixed(2))
        }] as const;
      }
    }));

    const checks = Object.fromEntries(entries);
    const circuits = this.circuitStates();
    const checksHealthy = Object.values(checks).every((result) => result.status === 'UP');
    const circuitsHealthy = Object.values(circuits).every((state) => state === 'closed');

    return {
      status: checksHealthy && circuitsHealthy ? 'UP' : 'DEGRADED',
      service: 'm2-clientes-api',
      checks,
      circuits
    };
  }

  readonly handler: RequestHandler = (_req, res, next) => {
    this.snapshot().then((snapshot) => {
      res.status(snapshot.status === 'UP' ? 200 : 503).json(snapshot);
    }).catch(next);
  };
}

export const healthRegistry = new HealthRegistry();

healthRegistry.register('postgres', async () => {
  await pool.query('SELECT 1');
  return true;
});
healthRegistry.register('redis', testRedisConnection);

export function registerHealthCheck(name: string, check: HealthCheck): () => void {
  return healthRegistry.register(name, check);
}

export function getHealthSnapshot(): Promise<HealthSnapshot> {
  return healthRegistry.snapshot();
}

export const healthHandler = healthRegistry.handler;
