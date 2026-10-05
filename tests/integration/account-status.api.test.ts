import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { customerRepository } from '../../src/repositories/customer.repository.js';
import { soporteClient } from '../../src/clients/soporte.client.js';
import { m6Client } from '../../src/clients/m6.client.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import type { AccountStatusResponse, CustomerProfile } from '../../src/types/customer.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TOKEN = 'Bearer tok-test';

function savedStatus(overrides: Partial<AccountStatusResponse> = {}): AccountStatusResponse {
  return {
    customerId: 'cust_823a7b9c',
    status: 'ACTIVO',
    reason: 'Perfil verificado y sin infracciones operativas',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides
  };
}

function activeCustomer(): CustomerProfile {
  return {
    customerId: 'cust_823a7b9c',
    name: 'Juan Pérez',
    email: 'juan.perez@example.com',
    phone: '+5493512345678',
    preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
    status: 'ACTIVO',
    createdAt: '2026-08-30T23:00:00Z'
  };
}

// ─── GET /v1/customers/:id/status ─────────────────────────────────────────────

describe('GET /v1/customers/:id/status (RF-2.5)', () => {
  beforeEach(() => {
    delete process.env.STATUS_SECRET_KEY;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STATUS_SECRET_KEY;
  });

  it('sin token → 401', async () => {
    const res = await request(app).get('/v1/customers/cust_823a7b9c/status');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('con X-Secret-Key válida → 200 (acceso de módulo interno)', async () => {
    process.env.STATUS_SECRET_KEY = 'secret-status';
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(savedStatus());
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 0, penalizaciones: [] });

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('X-Secret-Key', 'secret-status');
    expect(res.status).toBe(200);
  });

  it('cliente inexistente → 404', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(null);
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 0, penalizaciones: [] });

    const res = await request(app)
      .get('/v1/customers/cust_inexistente/status')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  it('0 penalizaciones → devuelve estado ACTIVO sin cambios', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(savedStatus());
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 0, penalizaciones: [] });

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVO');
  });

  it('2 penalizaciones → estado recalculado a BLOQUEADO_TEMPORAL', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(savedStatus({ status: 'ACTIVO' }));
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 2, penalizaciones: [] });
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(
      savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'AUTOMATICO', reason: 'Bloqueado automáticamente por 2 penalización(es) vigente(s)' })
    );

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('BLOQUEADO_TEMPORAL');
    expect(res.body.blockOrigin).toBe('AUTOMATICO');
  });

  it('3+ penalizaciones → estado recalculado a BLOQUEADO_PERMANENTE', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(savedStatus({ status: 'ACTIVO' }));
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 3, penalizaciones: [] });
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(
      savedStatus({ status: 'BLOQUEADO_PERMANENTE', blockOrigin: 'AUTOMATICO' })
    );

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('BLOQUEADO_PERMANENTE');
  });

  it('Soporte caído → devuelve último estado guardado (no 503)', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockResolvedValueOnce(
      savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'AUTOMATICO' })
    );
    vi.spyOn(soporteClient, 'getPenalizaciones').mockRejectedValueOnce(
      new ServiceUnavailableError('Soporte no disponible')
    );

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('BLOQUEADO_TEMPORAL');
  });

  it('DB caída → 503 con Retry-After', async () => {
    vi.spyOn(customerRepository, 'findAccountStatus').mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );
    vi.spyOn(soporteClient, 'getPenalizaciones').mockResolvedValueOnce({ userId: 12, total: 0, penalizaciones: [] });

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN)
      .timeout(2000);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ServiceUnavailable');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

// ─── PUT /v1/customers/:id/status ─────────────────────────────────────────────

describe('PUT /v1/customers/:id/status (RF-2.5)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin token → 401', async () => {
    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .send({ status: 'INACTIVO', reason: 'Baja solicitada' });
    expect(res.status).toBe(401);
  });

  it('estado inválido → 400 ValidationError', async () => {
    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN)
      .send({ status: 'ELIMINADO', reason: 'Borrado' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('dar de baja → 200, status INACTIVO, sin blockOrigin', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(
      savedStatus({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' })
    );

    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN)
      .send({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVO');
    expect(res.body.reason).toBe('Baja solicitada por el cliente');
  });

  it('bloqueo manual → 200, blockOrigin MANUAL', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(
      savedStatus({ status: 'BLOQUEADO_TEMPORAL', blockOrigin: 'MANUAL', reason: 'Solicitud del admin' })
    );

    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN)
      .send({ status: 'BLOQUEADO_TEMPORAL', reason: 'Solicitud del admin' });
    expect(res.status).toBe(200);
    expect(res.body.blockOrigin).toBe('MANUAL');
  });

  it('cliente inexistente → 404 CustomerNotFound', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/v1/customers/cust_inexistente/status')
      .set('Authorization', TOKEN)
      .send({ status: 'INACTIVO', reason: 'Baja solicitada' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  it('DB caída → 503', async () => {
    vi.spyOn(customerRepository, 'updateAccountStatus').mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );

    const res = await request(app)
      .put('/v1/customers/cust_823a7b9c/status')
      .set('Authorization', TOKEN)
      .send({ status: 'INACTIVO', reason: 'Baja solicitada' })
      .timeout(2000);
    expect(res.status).toBe(503);
  });
});

// ─── GET /v1/customers/:id/trips ──────────────────────────────────────────────

describe('GET /v1/customers/:id/trips (RF-2.3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin token → 401', async () => {
    const res = await request(app).get('/v1/customers/cust_823a7b9c/trips');
    expect(res.status).toBe(401);
  });

  it('cliente inexistente → 404', async () => {
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/customers/cust_inexistente/trips')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CustomerNotFound');
  });

  it('M6 disponible → 200 con historial de viajes', async () => {
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce(activeCustomer());
    vi.spyOn(m6Client, 'getTrips').mockResolvedValueOnce({
      customerId: '12',
      tripsCount: 1,
      trips: [{ tripId: 'trip_1', origin: 'A', destination: 'B', fare: 1500, status: 'COMPLETADO', createdAt: '2026-09-01T00:00:00Z' }]
    });

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/trips')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('cust_823a7b9c');
    expect(res.body.trips).toHaveLength(1);
  });

  it('M6 caído → 200 con lista vacía (respuesta degradada, no 503)', async () => {
    vi.spyOn(customerRepository, 'findById').mockResolvedValueOnce(activeCustomer());
    vi.spyOn(m6Client, 'getTrips').mockRejectedValueOnce(new ServiceUnavailableError('M6 caído'));

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/trips')
      .set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.tripsCount).toBe(0);
    expect(res.body.trips).toHaveLength(0);
  });

  it('DB caída → 503', async () => {
    vi.spyOn(customerRepository, 'findById').mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );

    const res = await request(app)
      .get('/v1/customers/cust_823a7b9c/trips')
      .set('Authorization', TOKEN)
      .timeout(2000);
    expect(res.status).toBe(503);
  });
});
