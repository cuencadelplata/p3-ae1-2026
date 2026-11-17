import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';

describe('Health Endpoints (RNF-05)', () => {
  const repository = new MemoryLocationRepository();
  const app = createApp({ locationRepository: repository });
  const client = supertest(app);

  it('GET /health/liveness debe retornar HTTP 200 OK con status UP', async () => {
    const response = await client.get('/health/liveness');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'UP');
    expect(response.body).toHaveProperty('service', 'm4-location-service');
  });

  it('GET /health/readiness debe retornar HTTP 200 OK con verificación de dependencias', async () => {
    const response = await client.get('/health/readiness');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'UP');
    expect(response.body.checks).toHaveProperty('redis', 'connected');
  });
});
