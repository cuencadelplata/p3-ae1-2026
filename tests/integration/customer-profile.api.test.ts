import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';
import { customerCache } from '../../src/cache/customer.cache.js';
import { m1AuthClient } from '../../src/clients/m1-auth.client.js';
import { UserIdSchema, type CustomerProfile } from '../../src/types/customer.js';

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

  it('marca base, caché y base después de actualizar preferencias', async () => {
    const profile: CustomerProfile = {
      customerId: 'cust_823a7b9c', userId: UserIdSchema.parse(12),
      preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
      status: 'ACTIVO', createdAt: '2026-08-30T23:00:00.000Z'
    };
    let cached: CustomerProfile | null = null;
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
    vi.spyOn(customerCache, 'get').mockImplementation(async () => cached);
    vi.spyOn(customerCache, 'set').mockImplementation(async (_id, customer) => { cached = customer; });
    vi.spyOn(customerCache, 'invalidate').mockImplementation(async () => { cached = null; });
    const find = vi.spyOn(customerRepository, 'findById').mockResolvedValue(profile);
    vi.spyOn(customerRepository, 'updatePreferences').mockResolvedValue({
      ...profile, preferences: { preferredVehicleType: 'moto', notificationChannel: 'push' }
    });

    const first = await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');
    const second = await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');
    await request(app).put('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer valid')
      .send({ preferences: { preferredVehicleType: 'moto', notificationChannel: 'push' } });
    const third = await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');

    expect(first.headers['x-data-source']).toBe('database');
    expect(second.headers['x-data-source']).toBe('cache');
    expect(third.headers['x-data-source']).toBe('database');
    expect(find).toHaveBeenCalledTimes(3);
  });
});
