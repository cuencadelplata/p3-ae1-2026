import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { customerService } from '../../src/services/customer.service.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { UserIdSchema, type AccountStatusEnum, type CustomerProfile, type NotificationChannel } from '../../src/types/customer.js';

// Contrato acordado con M8 (RF8.7): GET /internal/preferences/{userId}

const KEY = 'clave-m8-test';
const URL = '/internal/preferences/91';

function customer(channel: NotificationChannel, status: AccountStatusEnum = 'ACTIVO'): CustomerProfile {
  return {
    customerId: 'cust_0000005b',
    userId: UserIdSchema.parse(91),
    preferences: { preferredVehicleType: 'auto', notificationChannel: channel },
    status,
    createdAt: '2026-11-01T00:00:00Z'
  };
}

describe('GET /internal/preferences/:userId (contrato M8 RF8.7)', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_KEY', KEY);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('autenticación', () => {
    it('sin x-api-key → 401 sin consultar la base', async () => {
      const spy = vi.spyOn(customerService, 'getCustomerByUserId');
      const res = await request(app).get(URL);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
      expect(spy).not.toHaveBeenCalled();
    });

    it('x-api-key incorrecta → 401', async () => {
      const res = await request(app).get(URL).set('x-api-key', 'otra-clave');
      expect(res.status).toBe(401);
    });

    it('INTERNAL_API_KEY sin configurar → 401 aunque se envíe una clave', async () => {
      vi.stubEnv('INTERNAL_API_KEY', '');
      const res = await request(app).get(URL).set('x-api-key', '');
      expect(res.status).toBe(401);
    });

    it('un Bearer de usuario no reemplaza la clave de servicio → 401', async () => {
      const res = await request(app).get(URL).set('Authorization', 'Bearer tok');
      expect(res.status).toBe(401);
    });
  });

  describe('validación de userId', () => {
    it.each(['0', '-1', 'abc', '1.5', '1e3'])('userId "%s" → 400', async (userId) => {
      const res = await request(app).get(`/internal/preferences/${userId}`).set('x-api-key', KEY);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BadRequest');
    });
  });

  describe('respuesta 200', () => {
    it('canal push y cuenta ACTIVO → ambos true', async () => {
      const spy = vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(customer('push'));
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 91, notificationsEnabled: true, pushEnabled: true, notificationChannel: 'push' });
      expect(spy).toHaveBeenCalledWith(91);
    });

    it('canal email (default) → pushEnabled false', async () => {
      vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(customer('email'));
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 91, notificationsEnabled: true, pushEnabled: false, notificationChannel: 'email' });
    });

    it('cuenta INACTIVO → notificationsEnabled false', async () => {
      vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(customer('push', 'INACTIVO'));
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(200);
      expect(res.body.notificationsEnabled).toBe(false);
      expect(res.body.pushEnabled).toBe(true);
    });

    it.each(['BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE', 'EN_REVISIÓN'] as const)(
      'cuenta %s → notificationsEnabled true',
      async (status) => {
        vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(customer('push', status));
        const res = await request(app).get(URL).set('x-api-key', KEY);
        expect(res.status).toBe(200);
        expect(res.body.notificationsEnabled).toBe(true);
      }
    );

    it('devuelve el x-correlation-id recibido', async () => {
      vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(customer('push'));
      const res = await request(app).get(URL).set('x-api-key', KEY).set('x-correlation-id', 'trip-2026-000123');
      expect(res.headers['x-correlation-id']).toBe('trip-2026-000123');
    });
  });

  describe('404', () => {
    it('usuario sin perfil de cliente → 404 CustomerNotFound', async () => {
      vi.spyOn(customerService, 'getCustomerByUserId').mockResolvedValue(null);
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CustomerNotFound');
    });

    it('ruta inexistente → 404 NotFound (distinto de CustomerNotFound)', async () => {
      const res = await request(app).get('/internal/preferencias/91').set('x-api-key', KEY);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });
  });

  describe('503', () => {
    it('base caída → 503 con Retry-After', async () => {
      vi.spyOn(customerService, 'getCustomerByUserId').mockRejectedValue(new ServiceUnavailableError('postgres caído'));
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('ServiceUnavailable');
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('consulta lenta → 503 al vencer el plazo, sin esperar a la base', async () => {
      vi.stubEnv('INTERNAL_PREFERENCES_DEADLINE_MS', '50');
      vi.spyOn(customerService, 'getCustomerByUserId').mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(customer('push')), 1000))
      );
      const startedAt = Date.now();
      const res = await request(app).get(URL).set('x-api-key', KEY);
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBeDefined();
      expect(Date.now() - startedAt).toBeLessThan(900);
    });
  });
});
