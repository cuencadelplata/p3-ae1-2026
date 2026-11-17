import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { RedisService } from '../../src/services/redis.service';
import { RideOffer } from '../../src/types/ride-request.types';

describe('RedisService (RNF-06, RNF-08, RNF-09, Criterio 6)', () => {
  let redisService: RedisService;

  beforeEach(() => {
    process.env.DISABLE_REDIS = 'true';
    redisService = new RedisService();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });

  describe('Almacenamiento de Ofertas con TTL (RNF-06)', () => {
    const mockOffer: RideOffer = {
      id: 'off_test_123',
      requestId: 'req_test_123',
      driverId: 'drv_101',
      status: 'PENDING',
      estimatedFare: {
        amount: 2500,
        currency: 'ARS',
        estimatedDistanceKm: 4.5,
        estimatedDurationMin: 12
      },
      origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
      destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' },
      vehicleType: 'AUTO',
      ttlSeconds: 30,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30000).toISOString()
    };

    it('debe almacenar y recuperar una oferta por su ID', async () => {
      await redisService.saveOffer(mockOffer, 30);
      const retrieved = await redisService.getOffer(mockOffer.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('off_test_123');
      expect(retrieved?.driverId).toBe('drv_101');
    });

    it('debe devolver null para una oferta inexistente', async () => {
      const retrieved = await redisService.getOffer('oferta_inexistente');
      expect(retrieved).toBeNull();
    });

    it('debe reportar TTL restante positivo para una oferta recién guardada', async () => {
      await redisService.saveOffer(mockOffer, 60);
      const remainingTtl = await redisService.getRemainingTtl(mockOffer.id);
      expect(remainingTtl).toBeGreaterThan(0);
      expect(remainingTtl).toBeLessThanOrEqual(60);
    });

    it('debe eliminar una oferta explícitamente (Criterio 6: Invalidación)', async () => {
      await redisService.saveOffer(mockOffer, 60);
      await redisService.deleteOffer(mockOffer.id);

      const afterDelete = await redisService.getOffer(mockOffer.id);
      expect(afterDelete).toBeNull();
    });

    it('debe expirar la oferta automáticamente cuando se cumple el TTL (fallback en memoria)', async () => {
      await redisService.saveOffer(mockOffer, 1);

      // Esperar 1.1 segundos
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const retrieved = await redisService.getOffer(mockOffer.id);
      expect(retrieved).toBeNull();

      const remainingTtl = await redisService.getRemainingTtl(mockOffer.id);
      expect(remainingTtl).toBe(-2);
    });
  });

  describe('Bloqueo Distribuido (RNF-09)', () => {
    it('debe adquirir un lock cuando no hay conflicto', async () => {
      const acquired = await redisService.acquireLock('request_001');
      expect(acquired).toBe(true);
    });

    it('debe denegar un segundo lock mientras el primero está activo', async () => {
      const first = await redisService.acquireLock('request_002', 5000);
      expect(first).toBe(true);

      const second = await redisService.acquireLock('request_002', 5000);
      expect(second).toBe(false);
    });

    it('debe liberar el lock y permitir readquisición', async () => {
      await redisService.acquireLock('request_003', 5000);
      await redisService.releaseLock('request_003');

      const reacquired = await redisService.acquireLock('request_003', 5000);
      expect(reacquired).toBe(true);
    });
  });

  describe('Invalidación de Ofertas por Solicitud (RF-5.6)', () => {
    it('debe invalidar múltiples ofertas de forma atómica', async () => {
      const offer1: RideOffer = {
        id: 'off_inv_1', requestId: 'req_1', driverId: 'drv_1', status: 'PENDING',
        estimatedFare: { amount: 1000, currency: 'ARS', estimatedDistanceKm: 2, estimatedDurationMin: 5 },
        origin: { latitude: -34.60, longitude: -58.38, address: 'A' },
        destination: { latitude: -34.59, longitude: -58.39, address: 'B' },
        vehicleType: 'AUTO', ttlSeconds: 30,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30000).toISOString()
      };
      const offer2 = { ...offer1, id: 'off_inv_2', driverId: 'drv_2' };

      await redisService.saveOffer(offer1, 30);
      await redisService.saveOffer(offer2, 30);

      await redisService.invalidateOffersForRequest(['off_inv_1', 'off_inv_2']);

      expect(await redisService.getOffer('off_inv_1')).toBeNull();
      expect(await redisService.getOffer('off_inv_2')).toBeNull();
    });
  });

  describe('Marcado de Cancelación de Solicitudes (RF-5.6)', () => {
    it('debe marcar y verificar una solicitud como cancelada', async () => {
      await redisService.markRequestCancelled('req_cancel_1');
      const isCancelled = await redisService.isRequestCancelled('req_cancel_1');
      expect(isCancelled).toBe(true);
    });

    it('debe retornar false para solicitud no cancelada', async () => {
      const isCancelled = await redisService.isRequestCancelled('req_no_existe');
      expect(isCancelled).toBe(false);
    });
  });

  describe('Estado de conexión', () => {
    it('isReady debe reportar false en modo simulación', () => {
      expect(redisService.isReady()).toBe(false);
    });
  });
});
