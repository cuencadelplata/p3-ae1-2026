import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';

describe('RF-2.1 - Perfil autenticado de cliente', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mantiene público el listado sin userId', async () => {
    vi.spyOn(customerRepository, 'findAll').mockResolvedValue([]);

    const response = await request(app).get('/v1/customers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('protege el alta aunque el cuerpo sea válido', async () => {
    const response = await request(app).post('/v1/customers').send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('protege GET /me antes de interpretar me como customerId', async () => {
    const findById = vi.spyOn(customerRepository, 'findById');

    const response = await request(app).get('/v1/customers/me');

    expect(response.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it('protege la búsqueda por userId y la lectura por customerId', async () => {
    const byUserId = await request(app).get('/v1/customers?userId=12');
    const byCustomerId = await request(app).get('/v1/customers/cust_823a7b9c');

    expect(byUserId.status).toBe(401);
    expect(byCustomerId.status).toBe(401);
  });

  it('protege la actualización de preferencias', async () => {
    const response = await request(app)
      .put('/v1/customers/cust_823a7b9c')
      .send({ preferences: { preferredVehicleType: 'moto', notificationChannel: 'push' } });

    expect(response.status).toBe(401);
  });
});
