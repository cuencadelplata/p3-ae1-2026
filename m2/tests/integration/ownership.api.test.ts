import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findOwnedCustomer } from '../../src/controllers/ownership.js';
import { customerService } from '../../src/services/customer.service.js';
import { m1AuthClient } from '../../src/clients/m1-auth.client.js';
import { requireAuth } from '../../src/middlewares/auth.middleware.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { UserIdSchema, type CustomerProfile } from '../../src/types/customer.js';

const profile: CustomerProfile = {
  customerId: 'cust_823a7b9c',
  userId: UserIdSchema.parse(12),
  preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
  status: 'ACTIVO',
  createdAt: '2026-08-30T23:00:00.000Z'
};

function ownedApp() {
  const app = express();
  app.get('/customers/:id', requireAuth(), async (req, res, next) => {
    try {
      const customer = await findOwnedCustomer(req, res, req.params.id);
      if (customer) res.json(customer);
    } catch (error) {
      next(error);
    }
  });
  app.use(errorHandler);
  return app;
}

describe('D4 - propiedad de perfiles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('devuelve 404 si el perfil no existe', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(null);

    const response = await request(ownedApp()).get('/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');

    expect(response.status).toBe(404);
  });

  it('devuelve 403 si el perfil pertenece a otro usuario', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: UserIdSchema.parse(13), role: 'CLIENTE' });
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(profile);

    const response = await request(ownedApp()).get('/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');

    expect(response.status).toBe(403);
  });

  it('devuelve el perfil cuando el usuario es dueño', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: UserIdSchema.parse(12), role: 'CLIENTE' });
    vi.spyOn(customerService, 'getCustomerById').mockResolvedValue(profile);

    const response = await request(ownedApp()).get('/customers/cust_823a7b9c').set('Authorization', 'Bearer valid');

    expect(response.status).toBe(200);
    expect(response.body.customerId).toBe(profile.customerId);
  });
});
