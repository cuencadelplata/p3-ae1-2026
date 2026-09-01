import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../../src/app.js';

describe('GET /docs', () => {
  it('expone Swagger UI', async () => {
    const response = await request(app).get('/docs/');

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/html/);
    expect(response.text).toContain('Swagger UI');
  });
});
