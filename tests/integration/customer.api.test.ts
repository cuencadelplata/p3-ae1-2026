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

  it('GET /v1/customers/:id/trips debe retornar historial de viajes', async () => {
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce({
      customerId: 'cust_823a7b9c',
      name: 'Juan Pérez',
      email: 'juan.perez@example.com',
      phone: '+5493512345678',
      preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
      status: 'ACTIVO',
      createdAt: '2026-08-30T23:00:00Z'
    });

    const res = await request(app).get('/v1/customers/cust_823a7b9c/trips');
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('cust_823a7b9c');
    expect(res.body.trips).toBeInstanceOf(Array);
    expect(res.body.tripsCount).toBeGreaterThanOrEqual(1);
  });

  it('PUT /v1/customers/:id/status debe dar de baja al cliente con estado INACTIVO', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce({
      customerId: 'cust_823a7b9c',
      status: 'INACTIVO',
      reason: 'Baja solicitada por el cliente',
      updatedAt: '2026-10-03T12:00:00Z'
    });

    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .send({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVO');
    expect(res.body.reason).toBe('Baja solicitada por el cliente');
  });

  it('PUT /v1/customers/:id/status debe rechazar un estado inválido con 400', async () => {
    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .send({ status: 'ELIMINADO', reason: 'Borrado' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('PUT /v1/customers/:id/status debe retornar 404 si el cliente no existe', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/v1/customers/cust_inexistente/status')
      .send({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  it('DELETE /v1/customers/:id no debe existir (los clientes no se borran)', async () => {
    const res = await request(app).delete('/v1/customers/cust_823a7b9c');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });
});
