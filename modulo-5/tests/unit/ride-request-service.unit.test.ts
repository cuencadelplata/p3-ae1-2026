import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RideRequestService, ConflictError, NotFoundError, ValidationError } from '../../src/services/ride-request.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';
import { M4ClientService } from '../../src/services/m4-client.service';

/**
 * Tests Unitarios — RideRequestService
 * Cubre: RF-5.1 (crear solicitud), RF-5.2 (buscar candidatos), RF-5.3 (enviar ofertas con TTL),
 *        RF-5.4 (aceptar/rechazar), RF-5.5 (asignación única), RF-5.6 (cancelación previa),
 *        RF-5.7 (sin disponibilidad)
 */
describe('RideRequestService', () => {
  let service: RideRequestService;
  let m4Client: M4ClientService;

  const validDTO: CreateRideRequestDTO = {
    origin: { latitude: -34.6037, longitude: -58.3816, address: 'Av. 9 de Julio y Corrientes (Obelisco)' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Av. Alvear 1891 (Recoleta)' },
    vehicleType: 'AUTO',
  };

  beforeEach(() => {
    // Corrección RF-5.2: Se usan mocks sembrados explícitamente (aprobados) en vez de fallback silencioso
    m4Client = new M4ClientService();
    m4Client.seedMockDrivers([
      { driverId: 'drv_101', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 1.2, rating: 4.8 },
      { driverId: 'drv_102', latitude: -34.607, longitude: -58.385, vehicleType: 'AUTO', available: true, distanceKm: 2.1, rating: 4.7 },
      { driverId: 'drv_201', latitude: -34.604, longitude: -58.382, vehicleType: 'MOTO', available: true, distanceKm: 1.5, rating: 4.6 },
    ]);
    process.env.M4_MOCK = 'true';
    service = new RideRequestService(undefined, undefined, m4Client);
  });

  afterEach(() => {
    delete process.env.M4_MOCK;
    m4Client.clearMockDrivers();
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

    // ---- Correcciones RF-5.3 ----

    it('debe rechazar driverIds explícitos que no son elegibles/disponibles en M4 (Fix 1)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      // 'drv_fantasma' no existe en los mocks sembrados → debe ser descartado
      // Si todos son inválidos, lanza NotFoundError (NO_DRIVERS_AVAILABLE)
      await expect(
        service.sendOffersForRequest(request.id, 'client_1', {
          driverIds: ['drv_fantasma', 'drv_inexistente'],
          ttlSeconds: 30,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('debe filtrar driverIds no elegibles y crear ofertas solo para los válidos (Fix 1)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      // 'drv_101' existe y es elegible, 'drv_fantasma' no
      const result = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_fantasma'],
        ttlSeconds: 30,
      });

      expect(result.offersSentCount).toBe(1);
      expect(result.offers[0].driverId).toBe('drv_101');
    });

    it('no debe generar ofertas para solicitud cuyo plazo expiró (Fix 2 — RNF-09)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      // Forzar expiración manipulando el expiresAt en el pasado
      const storedRequest = await service.getRideRequestById(request.id, 'client_1');
      (storedRequest as any).expiresAt = new Date(Date.now() - 1000).toISOString();

      await expect(
        service.sendOffersForRequest(request.id, 'client_1', {
          driverIds: ['drv_101'],
          ttlSeconds: 30,
        })
      ).rejects.toThrow(ConflictError);

      // Verificar que el estado pasó a EXPIRED
      const updated = await service.getRideRequestById(request.id, 'client_1');
      expect(updated.status).toBe('EXPIRED');
    });

    it('debe deduplicar driverIds repetidos y crear una sola oferta por conductor (Fix 3)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      const result = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_101', 'drv_101'],
        ttlSeconds: 30,
      });

      // Solo 1 oferta aunque se pasó 3 veces el mismo ID
      expect(result.offersSentCount).toBe(1);
      expect(result.offers[0].driverId).toBe('drv_101');
    });

    it('no debe crear ofertas duplicadas si el conductor ya tiene oferta PENDING (Fix 3)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      // Primer envío: drv_101 recibe oferta
      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 60,
      });

      // Segundo envío: drv_101 ya tiene oferta PENDING → debe ser descartado
      // Solo drv_102 debería recibir oferta nueva
      const result2 = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      expect(result2.offersSentCount).toBe(1);
      expect(result2.offers[0].driverId).toBe('drv_102');
    });

    it('debe lanzar DUPLICATE_OFFERS si todos los driverIds ya tienen oferta PENDING (Fix 3)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);

      await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      // Segundo envío con los mismos IDs → todos ya tienen PENDING
      await expect(
        service.sendOffersForRequest(request.id, 'client_1', {
          driverIds: ['drv_101', 'drv_102'],
          ttlSeconds: 60,
        })
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
  //  RF-5.7: Sin disponibilidad y ciclo de tandas
  // ==========================================================================
  describe('RF-5.7 — Sin disponibilidad y ciclo de tandas', () => {
    it('cuando todos los conductores rechazan y aún hay plazo de búsqueda, regresa a SEARCHING para nueva ronda', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      // Rechazar todas las ofertas de la tanda
      for (const offer of offers.offers) {
        await service.respondToOffer(offer.id, offer.driverId, {
          action: 'REJECT',
          driverId: offer.driverId,
        });
      }

      const updated = await service.getRideRequestById(request.id, 'client_1');
      // Corrección RF-5.3/5.7: No cerrar toda la búsqueda por vencer una tanda si el plazo de búsqueda sigue vigente
      expect(updated.status).toBe('SEARCHING');
    });

    it('cuando todos los conductores rechazan y el plazo de búsqueda expiró, pasa a EXPIRED (RF-5.8 timeout)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const offers = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101', 'drv_102'],
        ttlSeconds: 60,
      });

      // Forzar que el plazo de búsqueda (expiresAt) ya venció
      const storedReq = await service.getRideRequestById(request.id, 'client_1');
      (storedReq as any).expiresAt = new Date(Date.now() - 1000).toISOString();

      // Rechazar todas las ofertas
      for (const offer of offers.offers) {
        await service.respondToOffer(offer.id, offer.driverId, {
          action: 'REJECT',
          driverId: offer.driverId,
        });
      }

      const updated = await service.getRideRequestById(request.id, 'client_1');
      expect(updated.status).toBe('EXPIRED');

      // Trazabilidad de timeout registrada
      const audit = service.getOfferAuditLog(request.id);
      expect(audit.some((e) => e.event === 'SEARCH_TIMEOUT')).toBe(true);
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

    // ========================================================================
    //  RF-5.3 / RF-5.8: Casos solicitados por cátedra (Trazabilidad, Timeout, Reinicios)
    // ========================================================================
    it('debe vencer tanda sin consultas y permitir nueva ronda (reinicio) si plazo está vigente', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const batch1 = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 15,
      });

      // Simular vencimiento de oferta sin respuesta del conductor (vencimiento sin consultas)
      const offer = await service.getOfferById(batch1.offers[0].id);
      (offer as any).expiresAt = new Date(Date.now() - 1000).toISOString();

      // Consulta de ofertas detona lazy expiration y verificación de tanda
      const offersAfter = await service.getOffersByRequestId(request.id, 'client_1');
      expect(offersAfter[0].status).toBe('EXPIRED');

      // Solicitud regresa a SEARCHING porque plazo de búsqueda sigue vigente
      const updatedReq = await service.getRideRequestById(request.id, 'client_1');
      expect(updatedReq.status).toBe('SEARCHING');

      // Trazabilidad registra BATCH_TIMEOUT
      const audit = service.getOfferAuditLog(request.id);
      expect(audit.some((e) => e.event === 'BATCH_TIMEOUT')).toBe(true);

      // Ahora se puede emitir una nueva ronda (reinicio de ofertas) con otro candidato
      const batch2 = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_102'],
        ttlSeconds: 30,
      });
      expect(batch2.offersSentCount).toBe(1);
      expect(batch2.offers[0].driverId).toBe('drv_102');
      const reqInBatch2 = await service.getRideRequestById(request.id, 'client_1');
      expect(reqInBatch2.status).toBe('OFFERED');
    });

    it('debe permitir aceptar oferta cerca del límite de expiración (RF-5.4 coordinación con RF-5.3)', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const batch = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 30,
      });
      const offerId = batch.offers[0].id;

      // Oferta configurada con 500ms restantes antes del límite
      const offer = await service.getOfferById(offerId);
      (offer as any).expiresAt = new Date(Date.now() + 500).toISOString();

      // Aceptación antes del límite exacto debe proceder correctamente
      const res = await service.respondToOffer(offerId, 'drv_101', {
        action: 'ACCEPT',
        driverId: 'drv_101',
      });
      expect(res.status).toBe('ACCEPTED');
      expect(res.requestStatus).toBe('ASSIGNED');

      // Registro de trazabilidad
      const audit = service.getOfferAuditLog(request.id);
      expect(audit.some((e) => e.event === 'OFFER_ACCEPTED')).toBe(true);
    });

    it('debe rechazar aceptación si el límite exacto ya fue superado por milisegundos', async () => {
      const request = await service.createRideRequest('client_1', 'key_1', validDTO);
      const batch = await service.sendOffersForRequest(request.id, 'client_1', {
        driverIds: ['drv_101'],
        ttlSeconds: 30,
      });
      const offerId = batch.offers[0].id;

      // Forzar que el límite acaba de expirar (10ms en el pasado)
      const offer = await service.getOfferById(offerId);
      (offer as any).expiresAt = new Date(Date.now() - 10).toISOString();

      await expect(
        service.respondToOffer(offerId, 'drv_101', {
          action: 'ACCEPT',
          driverId: 'drv_101',
        })
      ).rejects.toThrow(ConflictError);

      const audit = service.getOfferAuditLog(request.id);
      expect(audit.some((e) => e.event === 'OFFER_EXPIRED')).toBe(true);
    });
  });
});
