import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app, createApp } from '../../src/app.js';

describe('GET /health', () => {
  it('responde 200 con el estado básico del servicio', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({
      service: 'm9-reservas-programadas',
      status: 'ok',
    });
  });

  it('reutiliza el correlation id y lo incorpora al log HTTP', async () => {
    const logger = vi.fn();
    const response = await request(createApp({ requestLogger: logger }))
      .get('/health')
      .set('X-Correlation-Id', 'correlation-test');

    expect(response.headers['x-correlation-id']).toBe('correlation-test');
    expect(logger).toHaveBeenCalledWith({
      correlationId: 'correlation-test',
      method: 'GET',
      path: '/health',
      routeKind: 'health',
      statusCode: 200,
      durationMs: expect.any(Number),
    });
  });

  it('descarta un correlation id inválido y genera uno nuevo', async () => {
    const logger = vi.fn();
    const response = await request(createApp({ requestLogger: logger }))
      .get('/health')
      .set('X-Correlation-Id', `<script>${'x'.repeat(200)}`);

    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.mock.calls[0]?.[0].correlationId).toBe(response.headers['x-correlation-id']);
  });
});
