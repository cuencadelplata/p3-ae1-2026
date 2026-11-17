import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HealthRegistry } from '../../src/health/registry.js';
import type { CircuitStates } from '../../src/resilience/policies.js';

const closedCircuits = (): CircuitStates => ({
  postgres: 'closed',
  redis: 'closed',
  m1: 'closed',
  soporte: 'closed',
  m6: 'closed'
});

describe('Registro compartido de salud', () => {
  it('reporta UP con chequeos sanos y todos los circuitos', async () => {
    // Given
    const registry = new HealthRegistry(closedCircuits);
    registry.register('postgres', async () => true);
    registry.register('redis', async () => true);

    // When
    const snapshot = await registry.snapshot();

    // Then
    expect(snapshot.status).toBe('UP');
    expect(snapshot.checks.postgres?.status).toBe('UP');
    expect(snapshot.checks.redis?.status).toBe('UP');
    expect(Object.keys(snapshot.circuits).sort()).toEqual(['m1', 'm6', 'postgres', 'redis', 'soporte']);
  });

  it('responde 503 DEGRADED si una dependencia falla', async () => {
    // Given
    const registry = new HealthRegistry(closedCircuits);
    registry.register('postgres', async () => false);
    const app = express();
    app.get('/health', registry.handler);

    // When
    const response = await request(app).get('/health');

    // Then
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('DEGRADED');
    expect(response.body.checks.postgres.status).toBe('DOWN');
  });

  it('responde 200 DEGRADED si solo falla Redis', async () => {
    const registry = new HealthRegistry(closedCircuits);
    registry.register('postgres', async () => true);
    registry.register('redis', async () => false, { critical: false });
    const app = express();
    app.get('/health', registry.handler);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DEGRADED');
    expect(response.body.checks.redis.status).toBe('DOWN');
  });

  it('responde 200 DEGRADED cuando solo abre el circuito Redis', async () => {
    const registry = new HealthRegistry(() => ({ ...closedCircuits(), redis: 'open' }));
    registry.register('postgres', async () => true);
    const app = express();
    app.get('/health', registry.handler);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DEGRADED');
  });

  it('reporta DEGRADED cuando un circuito está abierto', async () => {
    // Given
    const registry = new HealthRegistry(() => ({ ...closedCircuits(), m1: 'open' }));
    registry.register('postgres', async () => true);

    // When
    const snapshot = await registry.snapshot();

    // Then
    expect(snapshot.status).toBe('DEGRADED');
    expect(snapshot.circuits.m1).toBe('open');
  });

  it('permite desregistrar un chequeo sin afectar los demás', async () => {
    // Given
    const registry = new HealthRegistry(closedCircuits);
    const unregister = registry.register('m1', async () => true);
    registry.register('redis', async () => true);

    // When
    unregister();
    const snapshot = await registry.snapshot();

    // Then
    expect(snapshot.checks.m1).toBeUndefined();
    expect(snapshot.checks.redis?.status).toBe('UP');
  });
});
