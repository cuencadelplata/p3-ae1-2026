import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../../src/app.js';

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
});
