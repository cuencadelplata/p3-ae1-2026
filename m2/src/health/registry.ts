import type { RequestHandler } from 'express';
import { pool } from '../config/db.js';
import { testRedisConnection } from '../config/redis.js';
import { createPolicy, getCircuitStates, type CircuitStates } from '../resilience/policies.js';

export type HealthCheck = () => Promise<boolean>;
export type HealthStatus = 'UP' | 'DEGRADED';

type CheckResult = {
  readonly status: 'UP' | 'DOWN';
  readonly responseTimeMs: number;
};

type RegisteredCheck = {
  readonly check: HealthCheck;
  readonly critical: boolean;
};

export type HealthSnapshot = {
  readonly status: HealthStatus;
  readonly service: 'm2-clientes-api';
  readonly checks: Readonly<Record<string, CheckResult>>;
  readonly circuits: CircuitStates;
  readonly criticalHealthy: boolean;
};

export class HealthRegistry {
  private readonly checks = new Map<string, RegisteredCheck>();

  constructor(private readonly circuitStates: () => CircuitStates = getCircuitStates) {}

  register(name: string, check: HealthCheck, options: { critical?: boolean } = {}): () => void {
    const registered = { check, critical: options.critical ?? true };
    this.checks.set(name, registered);
    return () => {
      if (this.checks.get(name) === registered) this.checks.delete(name);
    };
  }

  async snapshot(): Promise<HealthSnapshot> {
    const entries = await Promise.all([...this.checks.entries()].map(async ([name, { check }]) => {
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
    const criticalChecksHealthy = [...this.checks.entries()].every(([name, registration]) =>
      !registration.critical || checks[name]?.status === 'UP'
    );
    const criticalCircuitsHealthy = circuits.postgres === 'closed';

    return {
      status: checksHealthy && circuitsHealthy ? 'UP' : 'DEGRADED',
      service: 'm2-clientes-api',
      checks,
      circuits,
      criticalHealthy: criticalChecksHealthy && criticalCircuitsHealthy
    };
  }

  readonly handler: RequestHandler = (_req, res, next) => {
    this.snapshot().then((snapshot) => {
      res.status(snapshot.criticalHealthy ? 200 : 503).json(snapshot);
    }).catch(next);
  };
}

export const healthRegistry = new HealthRegistry();
const postgresPolicy = createPolicy('postgres');

healthRegistry.register('postgres', async () => {
  await postgresPolicy.execute(() => pool.query('SELECT 1'), { idempotent: true });
  return true;
});
healthRegistry.register('redis', testRedisConnection, { critical: false });

export function registerHealthCheck(name: string, check: HealthCheck, options?: { critical?: boolean }): () => void {
  return healthRegistry.register(name, check, options);
}

export function getHealthSnapshot(): Promise<HealthSnapshot> {
  return healthRegistry.snapshot();
}

export const healthHandler = healthRegistry.handler;
