import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';
import { m1AuthClient } from '../../src/clients/m1-auth.client.js';
import { UserIdSchema } from '../../src/types/customer.js';

describe('Endpoints REST - Módulo 2 Clientes (Supertest)', () => {
  it('GET /health debe responder con el estado del servicio', async () => {
    // El health check real verifica Postgres/Redis; sin ellos devuelve 503 (DOWN/DEGRADED).
    // Verificamos la estructura del contrato, no un UP que depende de infra externa.
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.service).toBe('m2-clientes-api');
    expect(['UP', 'DEGRADED', 'DOWN']).toContain(res.body.status);
  });

  it('GET /openapi.json debe retornar la especificación OpenAPI 3.0.3', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('Módulo 2');
  });

  it('POST /v1/customers debe rechazar body inválido con 400 Bad Request', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValueOnce({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
    const res = await request(app)
      .post('/v1/customers')
      .set('Authorization', 'Bearer fake_token')
      .send({ preferences: { preferredVehicleType: 'invalid_type' as any } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('GET /v1/customers/no-existe debe retornar 404 CustomerNotFound', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValueOnce({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce(null);

    const res = await request(app).get('/v1/customers/cust_inexistente').set('Authorization', 'Bearer fake_token');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  // GET /trips y PUT /status ahora requieren Authorization: Bearer <token>
  // Los tests completos de esos endpoints están en tests/unit/account-status.test.ts,
  // tests/unit/trips.test.ts y tests/integration/account-status.api.test.ts.
  // Acá solo verificamos el 401 sin token.

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
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValueOnce({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
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
