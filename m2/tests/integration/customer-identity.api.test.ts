import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.js';
import { m1AuthClient } from '../../src/clients/m1-auth.client.js';
import { m1ProfileClient } from '../../src/clients/m1-profile.client.js';
import { customerService } from '../../src/services/customer.service.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { UserIdSchema, type CustomerProfile } from '../../src/types/customer.js';

const profile: CustomerProfile = {
  customerId: 'cust_823a7b9c',
  userId: UserIdSchema.parse(12),
  preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
  status: 'ACTIVO',
  createdAt: '2026-08-30T23:00:00.000Z'
};
const identity = {
  nombre: 'Ana', apellido: 'Pérez', dni: '30111222', telefono: '+54 9 362 4111222',
  email: 'ana@example.com', rol: 'CLIENTE', estado: 'ACTIVO', creadoEn: '2026-09-01T12:00:00.000Z'
};
const authAs = (userId: number) => vi.spyOn(m1AuthClient, 'validateToken')
  .mockResolvedValue({ userId: UserIdSchema.parse(userId), role: 'CLIENTE' });

describe('RF-2.1 - Perfil con los datos personales de M1', () => {
  beforeEach(() => {
    vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(profile);
    vi.spyOn(customerService, 'getCustomerByIdWithSource').mockResolvedValue({ customer: profile, source: 'database' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET /me incluye identity consultando M1 con el token del usuario', async () => {
    authAs(12);
    const getIdentity = vi.spyOn(m1ProfileClient, 'getIdentity').mockResolvedValue({ userId: 12, ...identity });

    const res = await request(app).get('/v1/customers/me').set('Authorization', 'Bearer tok-ana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...profile, identity });
    expect(getIdentity).toHaveBeenCalledWith('tok-ana');
  });

  it('GET /:id del propio perfil incluye identity y conserva X-Data-Source', async () => {
    authAs(12);
    vi.spyOn(m1ProfileClient, 'getIdentity').mockResolvedValue({ userId: 12, ...identity });

    const res = await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer tok-ana');

    expect(res.status).toBe(200);
    expect(res.body.identity).toEqual(identity);
    expect(res.headers['x-data-source']).toBe('database');
  });

  it('GET /:id de un perfil ajeno no expone datos personales ni consulta M1', async () => {
    authAs(99);
    const getIdentity = vi.spyOn(m1ProfileClient, 'getIdentity');

    const res = await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer tok-otro');

    expect(res.status).toBe(200);
    expect(res.body.identity).toBeNull();
    expect(getIdentity).not.toHaveBeenCalled();
  });

  it('M1 caído → el perfil se devuelve igual, con identity null', async () => {
    authAs(12);
    vi.spyOn(m1ProfileClient, 'getIdentity').mockRejectedValue(new ServiceUnavailableError('M1 caído'));

    const res = await request(app).get('/v1/customers/me').set('Authorization', 'Bearer tok-ana');

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('cust_823a7b9c');
    expect(res.body.identity).toBeNull();
  });

  it('si M1 devuelve otro usuario, no se mezclan los datos', async () => {
    authAs(12);
    vi.spyOn(m1ProfileClient, 'getIdentity').mockResolvedValue({ userId: 13, ...identity, nombre: 'Bruno' });

    const res = await request(app).get('/v1/customers/me').set('Authorization', 'Bearer tok-ana');

    expect(res.body.identity).toBeNull();
  });

  it('los datos de M1 no quedan en la caché del perfil', async () => {
    authAs(12);
    vi.spyOn(m1ProfileClient, 'getIdentity').mockResolvedValue({ userId: 12, ...identity });
    const cached = vi.spyOn(customerService, 'getCustomerByIdWithSource');

    await request(app).get('/v1/customers/cust_823a7b9c').set('Authorization', 'Bearer tok-ana');

    // El servicio (y su caché) solo manejan el perfil de M2; identity se agrega en la respuesta
    expect(await cached.mock.results[0].value).toEqual({ customer: profile, source: 'database' });
    expect(profile).not.toHaveProperty('identity');
  });
});
