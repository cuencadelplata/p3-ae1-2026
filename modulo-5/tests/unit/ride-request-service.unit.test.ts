import { RideRequestService, ConflictError, NotFoundError, ValidationError } from '../../src/services/ride-request.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';

/**
 * Tests Unitarios — RideRequestService
 * Cubre: RF-5.1 (crear solicitud), RF-5.2 (buscar candidatos), RF-5.3 (enviar ofertas con TTL),
 *        RF-5.4 (aceptar/rechazar), RF-5.5 (asignación única), RF-5.6 (cancelación previa),
 *        RF-5.7 (sin disponibilidad)
 */
describe('RideRequestService', () => {
  let service: RideRequestService;

  const validDTO: CreateRideRequestDTO = {
    origin: { latitude: -34.6037, longitude: -58.3816, address: 'Av. 9 de Julio y Corrientes (Obelisco)' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Av. Alvear 1891 (Recoleta)' },
    vehicleType: 'AUTO',
  };

  beforeEach(() => {
    service = new RideRequestService();
  });

  // ==========================================================================
  //  RF-5.1: Solicitud de viaje
  // ==========================================================================
  describe('RF-5.1 — createRideRequest', () => {
    it('debe crear una solicitud de viaje exitosamente', async () => {
      const result = await service.createRideRequest('client_1', 'key_1', validDTO);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.clientId).toBe('client_1');
      expect(result.vehicleType).toBe('AUTO');
      expect(result.status).toBe('SEARCHING');
      expect(result.estimatedFare).toBeDefined();
      expect(result.estimatedFare.currency).toBe('ARS');
      expect(result.estimatedFare.amount).toBeGreaterThan(0);
      expect(result.origin.address).toBe(validDTO.origin.address);
      expect(result.destination.address).toBe(validDTO.destination.address);
    });

    it('debe retornar la misma solicitud para la misma idempotency key (RNF-08)', async () => {
      const first = await service.createRideRequest('client_1', 'idem_key_1', validDTO);
      const second = await service.createRideRequest('client_1', 'idem_key_1', validDTO);

      expect(first.id).toBe(second.id);
      expect(first.createdAt).toBe(second.createdAt);
    });

    it('debe lanzar ConflictError si el cliente ya tiene una solicitud activa', async () => {
      await service.createRideRequest('client_1', 'key_1', validDTO);

      await expect(
        service.createRideRequest('client_1', 'key_2', validDTO)
      ).rejects.toThrow(ConflictError);
    });

    it('debe lanzar ValidationError para datos de solicitud inválidos', async () => {
      const invalidDTO = { origin: null, destination: null, vehicleType: 'INVALID' } as any;

      await expect(
        service.createRideRequest('client_1', 'key_1', invalidDTO)
      ).rejects.toThrow(ValidationError);
    });

    it('debe crear solicitud con tipo MOTO', async () => {
      const motoDTO: CreateRideRequestDTO = { ...validDTO, vehicleType: 'MOTO' };
      const result = await service.createRideRequest('client_1', 'key_1', motoDTO);

      expect(result.vehicleType).toBe('MOTO');
      expect(result.estimatedFare.amount).toBeGreaterThan(0);
    });

    it('debe tener expiresAt en el futuro', async () => {
      const result = await service.createRideRequest('client_1', 'key_1', validDTO);
      const expiresAt = new Date(result.expiresAt).getTime();
      const now = Date.now();

      expect(expiresAt).toBeGreaterThan(now);
    });
  });

  // ==========================================================================
  //  RF-5.1: Obtener solicitud por ID
  // ==========================================================================
  describe('RF-5.1 — getRideRequestById', () => {
    it('debe obtener una solicitud existente por su ID', async () => {
      const created = await service.createRideRequest('client_1', 'key_1', validDTO);
      const fetched = await service.getRideRequestById(created.id, 'client_1');

      expect(fetched.id).toBe(created.id);
      expect(fetched.clientId).toBe('client_1');
    });

    it('debe lanzar NotFoundError para un ID inexistente', async () => {
      await expect(
        service.getRideRequestById('nonexistent_id', 'client_1')
      ).rejects.toThrow(NotFoundError);
    });

    it('debe lanzar ConflictError si el clientId no coincide (multi-tenant)', async () => {
      const created = await service.createRideRequest('client_1', 'key_1', validDTO);

      await expect(
        service.getRideRequestById(created.id, 'client_otro')
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  //  RF-5.2: Búsqueda de candidatos
  // ==========================================================================
  describe('RF-5.2 — searchCandidatesForRequest', () => {
    it('debe retornar candidatos filtrados por tipo de vehículo', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.searchCandidatesForRequest(request.id, 'client_1');

      expect(result.requestId).toBe(request.id);
      expect(result.vehicleType).toBe('AUTO');
      expect(result.candidatesCount).toBeGreaterThan(0);
      expect(result.candidates.length).toBe(result.candidatesCount);

      result.candidates.forEach((c) => {
        expect(c.vehicleType).toBe('AUTO');
        expect(c.distanceKm).toBeGreaterThan(0);
        expect(c.estimatedEtaMinutes).toBeGreaterThanOrEqual(1);
      });
    });

    it('debe ordenar candidatos por distancia ascendente', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.searchCandidatesForRequest(request.id, 'client_1');

      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i].distanceKm).toBeGreaterThanOrEqual(result.candidates[i - 1].distanceKm);
      }
    });

    it('debe lanzar ValidationError para opciones inválidas', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      await expect(
        service.searchCandidatesForRequest(request.id, 'client_1', { radiusKm: -1 })
      ).rejects.toThrow(ValidationError);
    });

    it('debe respetar el maxCandidates configurado', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.searchCandidatesForRequest(request.id, 'client_1', {
        maxCandidates: 1,
      });

      expect(result.candidatesCount).toBeLessThanOrEqual(1);
    });
  });

  // ==========================================================================
  //  RF-5.3: Oferta con vencimiento
  // ==========================================================================
  describe('RF-5.3 — sendOffersForRequest', () => {
    it('debe crear ofertas con TTL para conductores candidatos', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 30,
      });

      expect(result.requestId).toBe(request.id);
      expect(result.offersSentCount).toBe(2);
      expect(result.offers).toHaveLength(2);

      result.offers.forEach((offer) => {
        expect(offer.status).toBe('PENDING');
        expect(offer.ttlSeconds).toBe(30);
        expect(offer.driverId).toBeDefined();
        expect(new Date(offer.expiresAt).getTime()).toBeGreaterThan(Date.now());
      });
    });

    it('debe transicionar el estado de la solicitud a OFFERED', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 15,
      });

      const updated = await service.getRideRequestById(request.id, 'client_1');
      expect(updated.status).toBe('OFFERED');
    });

    it('debe buscar candidatos automáticamente si no se especifican driverIds', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.sendOffersForRequest(request.id, 'client_1');

      expect(result.offersSentCount).toBeGreaterThan(0);
    });

    it('debe lanzar ValidationError para ttlSeconds inválido', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      await expect(
        service.sendOffersForRequest(request.id, 'client_1', { ttlSeconds: 3 })
      ).rejects.toThrow(ValidationError);
    });

    it('no debe enviar ofertas para una solicitud CANCELLED', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.cancelRideRequest(request.id, 'client_1');

      await expect(
        service.sendOffersForRequest(request.id, 'client_1', { driverIds: ['drv_101'] })
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  //  RF-5.4: Aceptar o rechazar oferta
  // ==========================================================================
  describe('RF-5.4 — respondToOffer', () => {
    it('debe permitir a un conductor aceptar una oferta vigente', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offerId = offers.offers[0].id;
      const result = await service.respondToOffer(offerId, 'drv_101', {
        action: 'ACCEPT',
        driverId: 'drv_101',
      });

      expect(result.action).toBe('ACCEPT');
      expect(result.status).toBe('ACCEPTED');
      expect(result.requestStatus).toBe('ASSIGNED');
      expect(result.assignedDriverId).toBe('drv_101');
    });

    it('debe permitir a un conductor rechazar una oferta vigente', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offerId = offers.offers[0].id;
      const result = await service.respondToOffer(offerId, 'drv_101', {
        action: 'REJECT',
        driverId: 'drv_101',
      });

      expect(result.action).toBe('REJECT');
      expect(result.status).toBe('REJECTED');
    });

    it('debe lanzar NotFoundError para oferta inexistente', async () => {
      await expect(
        service.respondToOffer('nonexistent_offer', 'drv_101', { action: 'ACCEPT' })
      ).rejects.toThrow(NotFoundError);
    });

    it('debe lanzar ValidationError para action inválida', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      await expect(
        service.respondToOffer(offers.offers[0].id, 'drv_101', { action: 'CANCEL' as any })
      ).rejects.toThrow(ValidationError);
    });

    it('no debe permitir responder una oferta ya respondida', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offerId = offers.offers[0].id;
      await service.respondToOffer(offerId, 'drv_101', { action: 'ACCEPT', driverId: 'drv_101' });

      await expect(
        service.respondToOffer(offerId, 'drv_101', { action: 'ACCEPT', driverId: 'drv_101' })
      ).rejects.toThrow(ConflictError);
    });

    it('debe rechazar si el conductor no es el destinatario de la oferta', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      await expect(
        service.respondToOffer(offers.offers[0].id, 'drv_999', { action: 'ACCEPT', driverId: 'drv_999' })
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================================================
  //  RF-5.5: Asignación única
  // ==========================================================================
  describe('RF-5.5 — Asignación única', () => {
    it('solo un conductor puede quedar asignado ante respuestas concurrentes', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      const offer1Id = offers.offers[0].id;
      const offer2Id = offers.offers[1].id;
      const driver1 = offers.offers[0].driverId;
      const driver2 = offers.offers[1].driverId;

      // Primer conductor acepta
      const result1 = await service.respondToOffer(offer1Id, driver1, {
        action: 'ACCEPT',
        driverId: driver1,
      });
      expect(result1.requestStatus).toBe('ASSIGNED');
      expect(result1.assignedDriverId).toBe(driver1);

      // Segundo conductor intenta aceptar → debe fallar
      await expect(
        service.respondToOffer(offer2Id, driver2, { action: 'ACCEPT', driverId: driver2 })
      ).rejects.toThrow(ConflictError);
    });

    it('al aceptar una oferta, las demás ofertas PENDING se expiran automáticamente', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      const offer1Id = offers.offers[0].id;
      const offer2Id = offers.offers[1].id;
      const driver1 = offers.offers[0].driverId;

      await service.respondToOffer(offer1Id, driver1, { action: 'ACCEPT', driverId: driver1 });

      // Verificar que la segunda oferta se expiró
      const offer2 = await service.getOfferById(offer2Id);
      expect(offer2.status).toBe('EXPIRED');
    });

    it('debe asignar el conductor correcto al request', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      await service.respondToOffer(offers.offers[0].id, 'drv_101', {
        action: 'ACCEPT',
        driverId: 'drv_101',
      });

      const updated = await service.getRideRequestById(request.id, 'client_1');
      expect(updated.status).toBe('ASSIGNED');
      expect(updated.assignedDriverId).toBe('drv_101');
    });
  });

  // ==========================================================================
  //  RF-5.6: Cancelación previa
  // ==========================================================================
  describe('RF-5.6 — cancelRideRequest', () => {
    it('debe cancelar una solicitud en estado SEARCHING', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.cancelRideRequest(request.id, 'client_1', {
        reason: 'Cambio de planes',
      });

      expect(result.status).toBe('CANCELLED');
      expect(result.reason).toBe('Cambio de planes');
      expect(result.cancelledAt).toBeDefined();
    });

    it('debe cancelar una solicitud sin motivo (reason opcional)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const result = await service.cancelRideRequest(request.id, 'client_1');

      expect(result.status).toBe('CANCELLED');
    });

    it('no debe permitir cancelar una solicitud ya asignada (ASSIGNED)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      await service.respondToOffer(offers.offers[0].id, 'drv_101', {
        action: 'ACCEPT',
        driverId: 'drv_101',
      });

      await expect(
        service.cancelRideRequest(request.id, 'client_1')
      ).rejects.toThrow(ConflictError);
    });

    it('no debe permitir cancelar una solicitud ya cancelada', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.cancelRideRequest(request.id, 'client_1');

      await expect(
        service.cancelRideRequest(request.id, 'client_1')
      ).rejects.toThrow(ConflictError);
    });

    it('debe expirar todas las ofertas pendientes al cancelar', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      await service.cancelRideRequest(request.id, 'client_1', { reason: 'No necesito viaje' });

      // Verificar que las ofertas se expiraron
      for (const offer of offers.offers) {
        const updated = await service.getOfferById(offer.id);
        expect(updated.status).toBe('EXPIRED');
      }
    });

    it('debe lanzar ValidationError con motivo > 255 caracteres', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      await expect(
        service.cancelRideRequest(request.id, 'client_1', { reason: 'X'.repeat(256) })
      ).rejects.toThrow(ValidationError);
    });
  });

  // ==========================================================================
  //  RF-5.7: Sin disponibilidad
  // ==========================================================================
  describe('RF-5.7 — Sin disponibilidad', () => {
    it('cuando todos los conductores rechazan, el estado vuelve a NO_DRIVERS_AVAILABLE', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      // Rechazar todas las ofertas
      for (const offer of offers.offers) {
        await service.respondToOffer(offer.id, offer.driverId, {
          action: 'REJECT',
          driverId: offer.driverId,
        });
      }

      const updated = await service.getRideRequestById(request.id, 'client_1');
      expect(updated.status).toBe('NO_DRIVERS_AVAILABLE');
    });
  });

  // ==========================================================================
  //  Operaciones auxiliares
  // ==========================================================================
  describe('Operaciones auxiliares', () => {
    it('debe obtener ofertas por requestId', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offers = await service.getOffersByRequestId(request.id, 'client_1');
      expect(offers.length).toBeGreaterThan(0);
      expect(offers[0].requestId).toBe(request.id);
    });

    it('debe obtener ofertas por driverId', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offers = await service.getOffersForDriver('drv_101');
      expect(offers.length).toBeGreaterThan(0);
      expect(offers[0].driverId).toBe('drv_101');
    });

    it('debe obtener todas las ofertas del sistema', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      const allOffers = await service.getAllOffers();
      expect(allOffers.length).toBe(2);
    });

    it('debe obtener una oferta individual por su ID', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offersResult = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      const offer = await service.getOfferById(offersResult.offers[0].id);
      expect(offer).toBeDefined();
      expect(offer.id).toBe(offersResult.offers[0].id);
    });

    it('debe lanzar NotFoundError para oferta inexistente', async () => {
      await expect(service.getOfferById('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
