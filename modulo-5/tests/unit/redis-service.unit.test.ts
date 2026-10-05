import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { RedisService } from '../../src/services/redis.service';
import { RideRequest, EstimatedFare } from '../../src/types/ride-request.types';

describe('RedisService (RNF-06, RNF-08, RNF-09, Criterio 6)', () => {
  let redisService: RedisService;

  beforeEach(() => {
    redisService = new RedisService();
    redisService.clearFallback();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });

  describe('Idempotencia Distribuida (RNF-08)', () => {
    it('debe almacenar y recuperar una solicitud por su Idempotency-Key', async () => {
      const mockRequest: RideRequest = {
        id: 'req_123',
        clientId: 'client_1',
        origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
        destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' },
        vehicleType: 'AUTO',
        status: 'SEARCHING',
        estimatedFare: {
          amount: 2050,
          currency: 'ARS',
          estimatedDistanceKm: 3.8,
          estimatedDurationMin: 12,
          fareToken: 'ft_1'
        },
        assignedDriverId: null,
        idempotencyKey: 'idem_key_abc',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 180000).toISOString()
      };

      await redisService.saveIdempotentRequest('idem_key_abc', mockRequest, 3600);
      const retrieved = await redisService.getIdempotentRequest('idem_key_abc');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('req_123');
      expect(retrieved?.clientId).toBe('client_1');
      expect(retrieved?.estimatedFare.amount).toBe(2050);
    });

    it('debe devolver null para una Idempotency-Key inexistente', async () => {
      const retrieved = await redisService.getIdempotentRequest('clave_inexistente');
      expect(retrieved).toBeNull();
    });
  });

  describe('Candado Atómico de Cliente Activo (RNF-09, Criterio 6 y 7)', () => {
    it('debe adquirir candado con éxito para un cliente libre (operación SET NX)', async () => {
      const acquired = await redisService.acquireClientActiveLock('client_10', 'req_001', 180);
      expect(acquired).toBe(true);

      const activeReqId = await redisService.getActiveRequestIdForClient('client_10');
      expect(activeReqId).toBe('req_001');
    });

    it('debe denegar adquisición de candado si el cliente ya posee una solicitud activa (evita race condition)', async () => {
      const first = await redisService.acquireClientActiveLock('client_10', 'req_001', 180);
      expect(first).toBe(true);

      // Segunda solicitud concurrente con el mismo clientId
      const second = await redisService.acquireClientActiveLock('client_10', 'req_002', 180);
      expect(second).toBe(false);
    });

    it('debe invalidar y liberar el candado explícitamente (Criterio 6: Invalidación)', async () => {
      await redisService.acquireClientActiveLock('client_20', 'req_001', 180);
      expect(await redisService.getActiveRequestIdForClient('client_20')).toBe('req_001');

      // Invalidación explícita (ej. al cancelar o asignar)
      await redisService.releaseClientActiveLock('client_20');

      const afterRelease = await redisService.getActiveRequestIdForClient('client_20');
      expect(afterRelease).toBeNull();

      // Debe permitir volver a solicitar viaje tras la liberación
      const reacquire = await redisService.acquireClientActiveLock('client_20', 'req_002', 180);
      expect(reacquire).toBe(true);
    });
  });

  describe('Caché Efímero de Estimación de Tarifas M7 (RNF-06)', () => {
    it('debe cachear y recuperar una estimación de tarifa', async () => {
      const fare: EstimatedFare = {
        amount: 2225,
        currency: 'ARS',
        estimatedDistanceKm: 3.5,
        estimatedDurationMin: 12,
        fareToken: 'est_1234567890'
      };

      const cacheKey = '-27.46_-58.98_-27.47_-58.99_AUTO';
      await redisService.cacheEstimatedFare(cacheKey, fare, 60);

      const cached = await redisService.getCachedEstimatedFare(cacheKey);
      expect(cached).not.toBeNull();
      expect(cached?.amount).toBe(2225);
      expect(cached?.currency).toBe('ARS');
    });
  });
});
