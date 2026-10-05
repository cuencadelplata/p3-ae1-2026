import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createHealthController } from '../../src/controllers/health.controller.js';
import { createApp } from '../../src/app.js';

const createTestApp = (
  database: () => Promise<unknown>,
  m5: () => Promise<boolean>,
  m7: () => Promise<boolean>,
) => createApp({ healthHandler: createHealthController({ database, m5, m7 }) });

describe('GET /health', () => {
  it('responde 200 cuando todas las dependencias están disponibles', async () => {
    const response = await request(
      createTestApp(
        async () => undefined,
        async () => true,
        async () => true,
      ),
    ).get('/health');

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      service: 'm9-reservas-programadas',
      status: 'ok',
      dependencies: { database: 'ok', m5: 'ok', m7: 'ok' },
    });
  });

  it('responde degradado cuando una dependencia falla', async () => {
    const response = await request(
      createTestApp(
        async () => Promise.reject(new Error('PostgreSQL caído')),
        async () => false,
        async () => true,
      ),
    ).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      service: 'm9-reservas-programadas',
      status: 'degraded',
      dependencies: { database: 'down', m5: 'down', m7: 'ok' },
    });
  });
});
