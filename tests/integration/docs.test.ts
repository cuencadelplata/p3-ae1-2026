import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../../src/app.js';
import { openApiDocument } from '../../src/docs/openapi.js';

describe('GET /docs', () => {
  it('expone Swagger UI', async () => {
    const response = await request(app).get('/docs/');

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/html/);
    expect(response.text).toContain('Swagger UI');
  });

  it('documenta ejemplos y la ausencia de autenticación propia en AE1', () => {
    expect(openApiDocument.security).toEqual([]);
    expect(openApiDocument.info.description).toContain('no implementa autenticación propia');
    expect(JSON.stringify(openApiDocument)).toContain('CrearReservaValida');
    expect(JSON.stringify(openApiDocument)).toContain('ErrorNoEncontrada');
    expect(JSON.stringify(openApiDocument)).toContain('ErrorNoCancelable');
  });
});
