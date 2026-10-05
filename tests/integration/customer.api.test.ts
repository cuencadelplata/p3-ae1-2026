import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';

describe('Endpoints REST - Módulo 2 Clientes (Supertest)', () => {
  it('GET /health debe retornar estado UP', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.service).toBe('m2-clientes-api');
  });

  it('GET /openapi.json debe retornar la especificación OpenAPI 3.1', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toContain('Módulo 2');
  });

  it('POST /v1/customers debe rechazar body inválido con 400 Bad Request', async () => {
    const res = await request(app)
      .post('/v1/customers')
      .send({
        name: '',
        email: 'correo-invalido'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('GET /v1/customers/no-existe debe retornar 404 CustomerNotFound', async () => {
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce(null);

    const res = await request(app).get('/v1/customers/cust_inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  // GET /trips y PUT /status ahora requieren Authorization: Bearer <token>
  // Los tests completos de esos endpoints están en tests/unit/account-status.test.ts
  // y tests/unit/trips.test.ts. Acá solo verificamos el 401 sin token.

  it('GET /v1/customers/:id/trips sin token debe retornar 401', async () => {
    const res = await request(app).get('/v1/customers/cust_823a7b9c/trips');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('PUT /v1/customers/:id/status sin token debe retornar 401', async () => {
    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .send({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('PUT /v1/customers/:id/status debe rechazar un estado inválido con 400 (con token)', async () => {
    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', 'Bearer tok-test')
      .send({ status: 'ELIMINADO', reason: 'Borrado' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('DELETE /v1/customers/:id no debe existir (los clientes no se borran)', async () => {
    const res = await request(app).delete('/v1/customers/cust_823a7b9c');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });
});
