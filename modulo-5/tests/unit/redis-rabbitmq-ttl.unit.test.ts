import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { OfferCreatedEvent } from '../../src/types/ride-request.types';
import { RideRequestService } from '../../src/services/ride-request.service';
import { M4ClientService } from '../../src/services/m4-client.service';
import { CreateRideRequestDTO, RideOffer } from '../../src/types/ride-request.types';

describe('RNF-06 & RNF-07: Pruebas unitarias de Redis (TTL) y RabbitMQ', () => {
  let redisService: RedisService;
  let rabbitMQService: RabbitMQService;
  let rideRequestService: RideRequestService;
  let m4Client: M4ClientService;

  const sampleLocation = {
    latitude: -27.4678,
    longitude: -58.8344,
    address: 'Av. 3 de Abril 1234'
  };

  const sampleDestination = {
    latitude: -27.4721,
    longitude: -58.8295,
    address: 'Costanera Sur'
  };

  beforeEach(() => {
    // Forzar modo fallback en memoria para pruebas rápidas y deterministas
    process.env.DISABLE_REDIS = 'true';
    process.env.DISABLE_RABBITMQ = 'true';
    process.env.M4_MOCK = 'true';

    redisService = new RedisService();
    rabbitMQService = new RabbitMQService();

    // Corrección RF-5.2: Se usan mocks sembrados explícitamente (aprobados)
    m4Client = new M4ClientService();
    m4Client.seedMockDrivers([
      { driverId: 'drv_101', latitude: -27.468, longitude: -58.834, vehicleType: 'AUTO', available: true, distanceKm: 1.2, rating: 4.8 },
      { driverId: 'drv_102', latitude: -27.470, longitude: -58.832, vehicleType: 'AUTO', available: true, distanceKm: 2.1, rating: 4.7 },
    ]);

    rideRequestService = new RideRequestService(redisService, rabbitMQService, m4Client);
  });

  afterEach(() => {
    delete process.env.M4_MOCK;
    m4Client.clearMockDrivers();
  });

  describe('RedisService - Almacenamiento y TTL de Ofertas', () => {
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
      origin: sampleLocation,
      destination: sampleDestination,
      vehicleType: 'AUTO',
      ttlSeconds: 2,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2000).toISOString()
    };

    it('debe guardar una oferta en Redis y recuperarla antes de que expire', async () => {
      await redisService.saveOffer(mockOffer, 5);

      const retrieved = await redisService.getOffer(mockOffer.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(mockOffer.id);
      expect(retrieved?.driverId).toBe('drv_101');

      const remainingTtl = await redisService.getRemainingTtl(mockOffer.id);
      expect(remainingTtl).toBeGreaterThan(0);
      expect(remainingTtl).toBeLessThanOrEqual(5);
    });

    it('debe expirar la clave automáticamente cuando se cumple el TTL', async () => {
      // Guardar con 1 segundo de TTL
      await redisService.saveOffer(mockOffer, 1);

      // Esperar 1.1 segundos
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const retrieved = await redisService.getOffer(mockOffer.id);
      expect(retrieved).toBeNull();

      const remainingTtl = await redisService.getRemainingTtl(mockOffer.id);
      expect(remainingTtl).toBe(-2); // -2 indica que no existe / expiró
    });

    it('debe permitir eliminar una oferta manualmente de Redis', async () => {
      await redisService.saveOffer(mockOffer, 10);
      await redisService.deleteOffer(mockOffer.id);

      const retrieved = await redisService.getOffer(mockOffer.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('RabbitMQService - Publicación asíncrona', () => {
    it('debe publicar eventos OFFER_CREATED sin lanzar excepciones', async () => {
      const event: OfferCreatedEvent = {
        eventType: 'OFFER_CREATED',
        offerId: 'off_rabbit_1',
        requestId: 'req_rabbit_1',
        driverId: 'drv_101',
        ttlSeconds: 30,
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        origin: sampleLocation,
        destination: sampleDestination,
        vehicleType: 'AUTO',
        estimatedFare: {
          amount: 2000,
          currency: 'ARS',
          estimatedDistanceKm: 3,
          estimatedDurationMin: 8
        },
        timestamp: new Date().toISOString()
      };

      const published = await rabbitMQService.publishOfferCreated(event);
      expect(published).toBe(true);
    });
  });

  describe('RF-5.3: Despacho de ofertas con Redis y RabbitMQ en RideRequestService', () => {
    const createDto: CreateRideRequestDTO = {
      origin: sampleLocation,
      destination: sampleDestination,
      vehicleType: 'AUTO'
    };

    it('CP-5.3-09: Identificar clave Redis y comprobar vencimiento -> Durante vigencia existe con TTL positivo; tras vencimiento sin responder, ya no existe', async () => {
      const request = await rideRequestService.createRideRequest('client_redis', 'idem_redis', createDto);
      const ttlSec = 5;

      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_redis', {
        ttlSeconds: ttlSec,
        driverIds: ['drv_101']
      });

      const offer = dispatchResult.offers[0];
      const redisKey = `dispatch:offer:${offer.id}`;

      // 1. Durante la vigencia: existe y tiene TTL positivo
      const duringOffer = await redisService.getOffer(offer.id);
      expect(duringOffer).not.toBeNull();
      expect(duringOffer?.id).toBe(offer.id);
      const ttlRemaining = await redisService.getRemainingTtl(offer.id);
      expect(ttlRemaining).toBeGreaterThan(0);
      expect(ttlRemaining).toBeLessThanOrEqual(ttlSec);

      // 2. Consulta después del plazo sin aceptar, rechazar ni cancelar:
      // Simulamos paso del tiempo superando el TTL en memoria
      const store = (redisService as any).fallbackMemory || (redisService as any).memoryFallback;
      const inMemoryOffer = store ? store.get(redisKey) : null;
      if (inMemoryOffer) {
        inMemoryOffer.expiresAt = Date.now() - 1000;
      }

      const afterOffer = await redisService.getOffer(offer.id);
      expect(afterOffer).toBeNull();
      const ttlAfter = await redisService.getRemainingTtl(offer.id);
      expect(ttlAfter).toBe(-2); // -2 en Redis = clave expirada/inexistente
    });

    it('CP-5.3-14: La oferta llega al receptor -> Consumidor en cola dispatch.offers recibe la oferta con mismos IDs de solicitud, conductor y vencimiento', async () => {
      const request = await rideRequestService.createRideRequest('client_rabbit', 'idem_rabbit', createDto);

      let receivedEvent: OfferCreatedEvent | null = null;
      // Suscribir consumidor que simula al receptor/módulo del conductor
      await rabbitMQService.subscribeToOfferCreated((evt) => {
        receivedEvent = evt;
      });

      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_rabbit', {
        ttlSeconds: 20,
        driverIds: ['drv_101']
      });

      const sentOffer = dispatchResult.offers[0];

      // Verificamos evidencia de recepción por el consumidor
      expect(receivedEvent).not.toBeNull();
      expect((receivedEvent as any).offerId).toBe(sentOffer.id);
      expect((receivedEvent as any).requestId).toBe(request.id);
      expect((receivedEvent as any).driverId).toBe('drv_101');
      expect((receivedEvent as any).ttlSeconds).toBe(20);
      expect((receivedEvent as any).expiresAt).toBe(sentOffer.expiresAt);
    });

    it('al despachar ofertas, debe guardarlas en Redis y emitir a RabbitMQ', async () => {
      const request = await rideRequestService.createRideRequest('client_1', 'idem_1', createDto);

      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_1', {
        ttlSeconds: 10,
        driverIds: ['drv_101', 'drv_102']
      });

      expect(dispatchResult.offersSentCount).toBe(2);
      expect(dispatchResult.offers[0].ttlSeconds).toBe(10);

      // Verificar que ambas ofertas existen en Redis con TTL válido
      for (const offer of dispatchResult.offers) {
        const fromRedis = await redisService.getOffer(offer.id);
        expect(fromRedis).not.toBeNull();
        expect(fromRedis?.id).toBe(offer.id);

        const ttl = await redisService.getRemainingTtl(offer.id);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(10);
      }
    });

    it('debe rechazar la respuesta a una oferta si ya expiró en Redis', async () => {
      jest.useFakeTimers();
      const request = await rideRequestService.createRideRequest('client_2', 'idem_2', createDto);

      // Oferta con 5 segundos de TTL (mínimo permitido por esquema de validación)
      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_2', {
        ttlSeconds: 5,
        driverIds: ['drv_101']
      });

      const offerId = dispatchResult.offers[0].id;

      // Avanzar el reloj 6 segundos para superar el TTL
      jest.advanceTimersByTime(6000);

      // El conductor intenta responder pero la oferta ya expiró
      await expect(
        rideRequestService.respondToOffer(offerId, 'drv_101', { action: 'ACCEPT' })
      ).rejects.toThrow('La oferta ha expirado y ya no está vigente');

      jest.useRealTimers();
    });

    it('al aceptar una oferta, debe asignarla y removerla de Redis', async () => {
      const request = await rideRequestService.createRideRequest('client_3', 'idem_3', createDto);

      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_3', {
        ttlSeconds: 30,
        driverIds: ['drv_101', 'drv_102']
      });

      const acceptedOfferId = dispatchResult.offers[0].id;
      const otherOfferId = dispatchResult.offers[1].id;

      const response = await rideRequestService.respondToOffer(acceptedOfferId, 'drv_101', { action: 'ACCEPT' });

      expect(response.status).toBe('ACCEPTED');
      expect(response.requestStatus).toBe('ASSIGNED');

      // Ambas ofertas deben haber sido limpiadas de Redis (la aceptada y las revocadas)
      const redisAccepted = await redisService.getOffer(acceptedOfferId);
      const redisOther = await redisService.getOffer(otherOfferId);
      expect(redisAccepted).toBeNull();
      expect(redisOther).toBeNull();
    });

    it('al cancelar la solicitud el cliente, debe limpiar las ofertas pendientes de Redis', async () => {
      const request = await rideRequestService.createRideRequest('client_4', 'idem_4', createDto);

      const dispatchResult = await rideRequestService.sendOffersForRequest(request.id, 'client_4', {
        ttlSeconds: 30,
        driverIds: ['drv_101']
      });

      const offerId = dispatchResult.offers[0].id;

      await rideRequestService.cancelRideRequest(request.id, 'client_4', {
        reason: 'Ya no necesito el viaje'
      });

      // La oferta no debe existir en Redis
      const fromRedis = await redisService.getOffer(offerId);
      expect(fromRedis).toBeNull();
    });
  });
});
