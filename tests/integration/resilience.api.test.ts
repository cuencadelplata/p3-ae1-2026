import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';

// Simula el error que lanza pg cuando PostgreSQL está apagado
function dbDownError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
}

const validCustomer = {
  name: 'Juan Pérez',
  email: 'juan.perez@example.com',
  phone: '+5493512345678'
};

describe('RF-2.1 - Errores controlados con PostgreSQL caído', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /v1/customers/:id debe responder 503 con Retry-After y no colgarse', async () => {
    vi.spyOn(customerRepository, 'findById').mockRejectedValueOnce(dbDownError());

    const res = await request(app).get('/v1/customers/cust_823a7b9c').timeout(2000);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ServiceUnavailable');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfter));
  });

  it('GET /v1/customers/:id debe responder 503 ante un timeout del pool', async () => {
    vi.spyOn(customerRepository, 'findById').mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'));

    const res = await request(app).get('/v1/customers/cust_823a7b9c').timeout(2000);
    expect(res.status).toBe(503);
  });

  it('GET /v1/customers debe responder 503 con la DB caída', async () => {
    vi.spyOn(customerRepository, 'findAll').mockRejectedValueOnce(dbDownError());

    const res = await request(app).get('/v1/customers').timeout(2000);
    expect(res.status).toBe(503);
  });

  it('POST /v1/customers debe responder 503 (no confirma lo que no se guardó)', async () => {
    vi.spyOn(customerRepository, 'create').mockRejectedValueOnce(dbDownError());

    const res = await request(app).post('/v1/customers').send(validCustomer).timeout(2000);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ServiceUnavailable');
  });

  it('POST /v1/customers debe seguir respondiendo 409 si el email ya existe', async () => {
    vi.spyOn(customerRepository, 'create').mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    );

    const res = await request(app).post('/v1/customers').send(validCustomer).timeout(2000);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EmailAlreadyExists');
  });

  it('PUT /v1/customers/:id debe responder 503 con la DB caída', async () => {
    vi.spyOn(customerRepository, 'findById').mockRejectedValueOnce(dbDownError());

    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c')
      .send({ preferences: { preferredVehicleType: 'moto', notificationChannel: 'push' } })
      .timeout(2000);
    expect(res.status).toBe(503);
  });

  it('un error inesperado debe responder 500 sin exponer stack trace ni el mensaje interno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(customerRepository, 'findById').mockRejectedValueOnce(new TypeError('secreto interno: columna x'));

    const res = await request(app).get('/v1/customers/cust_823a7b9c').timeout(2000);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError', message: 'Ocurrió un error inesperado' });
    expect(JSON.stringify(res.body)).not.toContain('secreto interno');
  });

  it('un body con JSON mal formado debe responder 400 en JSON y no una página con stack trace', async () => {
    const res = await request(app)
      .post('/v1/customers')
      .set('Content-Type', 'application/json')
      .send('{"name": "Juan",')
      .timeout(2000);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});
