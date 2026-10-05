import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { redis } from '../../src/cache/redis';
import { AppError } from '../../src/errors/app-error';
import {
  authorizeReceiptPermission,
  createM1IdentityValidator,
  type AuthenticatedUser,
} from '../../src/middlewares/auth.middleware';
import type { Receipt } from '../../src/models/receipt';
import {
  acquireResendLock,
  checkResendRateLimit,
  getCachedReceipt,
  invalidateReceiptCache,
  setCachedReceipt,
} from '../../src/services/resend-protection.service';
import { validateResendRequest } from '../../src/validators/receipt.validator';

const mockReceipt: Receipt = {
  receiptId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  receiptNumber: 'CMP-2026-TEST001',
  tripId: 'trip-resend-test-01',
  issuedAt: new Date().toISOString(),
  customerUserId: 101,
  driverUserId: 202,
  customer: {
    id: 'cli-101',
    fullName: 'Lucas Cremaschi',
    email: 'lucas@example.com',
  },
  driver: {
    id: 'cnd-202',
    fullName: 'Martin Rodriguez',
    vehicle: { type: 'AUTO', plate: 'UTN123' },
  },
  trip: {
    origin: 'Facultad UTN FRC',
    destination: 'Plaza San Martin',
    startedAt: '2026-09-01T18:00:00.000Z',
    finishedAt: '2026-09-01T18:25:00.000Z',
    distanceKm: 6.5,
    durationMin: 25,
  },
  fare: {
    currency: 'ARS',
    baseFare: 3500,
    distanceAmount: 0,
    timeAmount: 0,
    surcharges: 0,
    discounts: 0,
    total: 3500,
  },
  payment: {
    method: 'TARJETA',
    status: 'APROBADO',
  },
  deliveries: [],
};

describe('RF-8.4: Reenvio de comprobante (Lucas Cremaschi)', () => {
  describe('Integracion con M1 - Autenticacion y Permisos', () => {
    it('debe usar M1 para validar el Bearer y conservar el userId numerico', async () => {
      let authorization = '';
      const validator = createM1IdentityValidator(
        'http://m1.test/auth/validar-identidad-y-rol',
        100,
        async (_url, options) => {
          authorization = new Headers(options?.headers).get('authorization') ?? '';
          return new Response(JSON.stringify({ userId: 101, role: 'CLIENTE' }), { status: 200 });
        },
      );

      const user = await validator('Bearer token-de-m1');
      assert.equal(authorization, 'Bearer token-de-m1');
      assert.equal(user.userId, 101);
      assert.equal(user.role, 'CLIENTE');
    });

    it('debe rechazar una identidad M1 con userId no numerico', async () => {
      const validator = createM1IdentityValidator(
        'http://m1.test/auth/validar-identidad-y-rol',
        100,
        async () => new Response(JSON.stringify({ userId: '101', role: 'CLIENTE' }), { status: 200 }),
      );
      await assert.rejects(() => validator('Bearer token-de-m1'), (err: unknown) => {
        return err instanceof AppError && err.code === 'M1_IDENTITY_INVALID_RESPONSE';
      });
    });

    it('debe propagar el rechazo de un Bearer informado por M1', async () => {
      const validator = createM1IdentityValidator(
        'http://m1.test/auth/validar-identidad-y-rol',
        100,
        async () => new Response(null, { status: 401 }),
      );
      await assert.rejects(() => validator('Bearer token-invalido'), (err: unknown) => {
        return err instanceof AppError && err.status === 401 && err.code === 'INVALID_AUTH_TOKEN';
      });
    });

    it('debe autorizar a un CLIENTE que es dueno del comprobante', () => {
      const user: AuthenticatedUser = { userId: 101, role: 'CLIENTE' };
      assert.doesNotThrow(() => authorizeReceiptPermission(mockReceipt, user));
    });

    it('debe denegar acceso a un CLIENTE sobre el comprobante de otro cliente (403)', () => {
      const user: AuthenticatedUser = { userId: 999, role: 'CLIENTE' };
      assert.throws(() => authorizeReceiptPermission(mockReceipt, user), (err: unknown) => {
        return err instanceof AppError && err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS';
      });
    });

    it('debe autorizar al CONDUCTOR que realizo el viaje', () => {
      const user: AuthenticatedUser = { userId: 202, role: 'CONDUCTOR' };
      assert.doesNotThrow(() => authorizeReceiptPermission(mockReceipt, user));
    });

    it('debe denegar acceso a un CONDUCTOR ajeno al viaje (403)', () => {
      const user: AuthenticatedUser = { userId: 999, role: 'CONDUCTOR' };
      assert.throws(() => authorizeReceiptPermission(mockReceipt, user), (err: unknown) => {
        return err instanceof AppError && err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS';
      });
    });

    it('debe autorizar a un usuario con rol OPERADOR sobre cualquier comprobante', () => {
      const user: AuthenticatedUser = { userId: 1, role: 'OPERADOR' };
      assert.doesNotThrow(() => authorizeReceiptPermission(mockReceipt, user));
    });
  });

  describe('Redis - Cache de Metadatos con TTL', () => {
    const memoryStore = new Map<string, string>();
    const originalGet = redis.get.bind(redis);
    const originalSet = redis.set.bind(redis);
    const originalDel = redis.del.bind(redis);

    beforeEach(() => {
      memoryStore.clear();
      (redis as unknown as Record<string, unknown>).get = (async (key: string) => memoryStore.get(key) ?? null) as unknown as typeof redis.get;
      (redis as unknown as Record<string, unknown>).set = (async (key: string, value: string) => {
        memoryStore.set(key, value);
        return 'OK';
      }) as unknown as typeof redis.set;
      (redis as unknown as Record<string, unknown>).del = (async (key: string) => {
        const deleted = memoryStore.delete(key);
        return deleted ? 1 : 0;
      }) as unknown as typeof redis.del;
    });

    afterEach(() => {
      (redis as unknown as Record<string, unknown>).get = originalGet;
      (redis as unknown as Record<string, unknown>).set = originalSet;
      (redis as unknown as Record<string, unknown>).del = originalDel;
    });

    it('debe guardar y recuperar comprobante cacheado en Redis', async () => {
      await setCachedReceipt(mockReceipt, 300);
      const cached = await getCachedReceipt(mockReceipt.tripId);
      assert.ok(cached);
      assert.equal(cached.tripId, mockReceipt.tripId);
      assert.equal(cached.receiptNumber, mockReceipt.receiptNumber);
    });

    it('debe retornar null en caso de cache miss', async () => {
      const cached = await getCachedReceipt('trip-inexistente');
      assert.equal(cached, null);
    });

    it('debe invalidar la clave de cache al actualizar el comprobante', async () => {
      await setCachedReceipt(mockReceipt, 300);
      await invalidateReceiptCache(mockReceipt.tripId);
      const cached = await getCachedReceipt(mockReceipt.tripId);
      assert.equal(cached, null);
    });
  });

  describe('Redis - Bloqueo Distribuido (Locks) ante Reenvios Concurrentes', () => {
    const lockStore = new Map<string, string>();
    const originalSet = redis.set.bind(redis);
    const originalEval = redis.eval.bind(redis);

    beforeEach(() => {
      lockStore.clear();
      (redis as unknown as Record<string, unknown>).set = (async (key: string, val: string, options?: { condition?: string }) => {
        if (options?.condition === 'NX' && lockStore.has(key)) {
          return null; // Lock ocupado
        }
        lockStore.set(key, val);
        return 'OK';
      }) as unknown as typeof redis.set;

      (redis as unknown as Record<string, unknown>).eval = (async (_script: string, opts: { keys: string[]; arguments: string[] }) => {
        const key = opts.keys[0];
        const val = opts.arguments[0];
        if (lockStore.get(key) === val) {
          lockStore.delete(key);
          return 1;
        }
        return 0;
      }) as unknown as typeof redis.eval;
    });

    afterEach(() => {
      (redis as unknown as Record<string, unknown>).set = originalSet;
      (redis as unknown as Record<string, unknown>).eval = originalEval;
    });

    it('el primer intento debe adquirir el lock exitosamente', async () => {
      const lock = await acquireResendLock('trip-lock-test');
      assert.equal(lock.acquired, true);
      await lock.release();
    });

    it('un segundo intento concurrente debe fallar si el lock no ha sido liberado', async () => {
      const lock1 = await acquireResendLock('trip-lock-test');
      assert.equal(lock1.acquired, true);

      // Simulamos clic concurrente antes de que termine el primer reenvio
      const lock2 = await acquireResendLock('trip-lock-test');
      assert.equal(lock2.acquired, false);

      await lock1.release();

      // Despues de liberar, un nuevo intento debe poder adquirirlo
      const lock3 = await acquireResendLock('trip-lock-test');
      assert.equal(lock3.acquired, true);
      await lock3.release();
    });
  });

  describe('Redis - Rate Limiting de Reenvios', () => {
    const rateStore = new Map<string, { count: number; ttl: number }>();
    const originalIncr = redis.incr.bind(redis);
    const originalExpire = redis.expire.bind(redis);
    const originalTtl = redis.ttl.bind(redis);

    beforeEach(() => {
      rateStore.clear();
      (redis as unknown as Record<string, unknown>).incr = (async (key: string) => {
        const item = rateStore.get(key) ?? { count: 0, ttl: 60 };
        item.count += 1;
        rateStore.set(key, item);
        return item.count;
      }) as unknown as typeof redis.incr;

      (redis as unknown as Record<string, unknown>).expire = (async (key: string, seconds: number) => {
        const item = rateStore.get(key);
        if (item) {
          item.ttl = seconds;
          return 1;
        }
        return 0;
      }) as unknown as typeof redis.expire;

      (redis as unknown as Record<string, unknown>).ttl = (async (key: string) => {
        return rateStore.get(key)?.ttl ?? -2;
      }) as unknown as typeof redis.ttl;
    });

    afterEach(() => {
      (redis as unknown as Record<string, unknown>).incr = originalIncr;
      (redis as unknown as Record<string, unknown>).expire = originalExpire;
      (redis as unknown as Record<string, unknown>).ttl = originalTtl;
    });

    it('debe permitir solicitudes dentro del limite de tasa configurado (ej. max 2)', async () => {
      const r1 = await checkResendRateLimit('test-rate', 2, 60);
      assert.equal(r1.allowed, true);
      assert.equal(r1.remaining, 1);

      const r2 = await checkResendRateLimit('test-rate', 2, 60);
      assert.equal(r2.allowed, true);
      assert.equal(r2.remaining, 0);
    });

    it('debe rechazar solicitudes cuando se supera el limite de tasa', async () => {
      await checkResendRateLimit('test-rate-limit', 2, 60);
      await checkResendRateLimit('test-rate-limit', 2, 60);

      const r3 = await checkResendRateLimit('test-rate-limit', 2, 60);
      assert.equal(r3.allowed, false);
      assert.equal(r3.remaining, 0);
      assert.ok(r3.retryAfterSeconds > 0);
    });
  });

  describe('Validacion de Solicitudes de Reenvio', () => {
    it('debe aceptar canales validos (EMAIL, SMS, PUSH)', () => {
      for (const channel of ['EMAIL', 'SMS', 'PUSH']) {
        const result = validateResendRequest({ channel, destination: 'destino@test.com' });
        assert.equal(result.ok, true);
      }
    });

    it('debe tomar EMAIL como canal por defecto si no se especifica', () => {
      const result = validateResendRequest({});
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.channel, 'EMAIL');
      }
    });

    it('debe rechazar un canal no soportado', () => {
      const result = validateResendRequest({ channel: 'WHATSAPP' });
      assert.equal(result.ok, false);
    });
  });
});
