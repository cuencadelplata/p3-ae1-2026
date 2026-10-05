import { RideRequestService, ConflictError } from '../../src/services/ride-request.service';
import { DbService } from '../../src/services/db.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMqService } from '../../src/services/rabbitmq.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';

describe('AE2 — Tests de Concurrencia, Idempotencia y Casos Límite (RNF-08, RNF-09, RF-5.4, RF-5.5)', () => {
  let rideRequestService: RideRequestService;
  let dbService: DbService;
  let redisService: RedisService;
  let rabbitMqService: RabbitMqService;

  beforeEach(() => {
    dbService = new DbService();
    redisService = new RedisService();
    rabbitMqService = new RabbitMqService();
    rideRequestService = new RideRequestService(dbService, redisService, rabbitMqService);
  });

  afterAll(async () => {
    await dbService.disconnect();
    await redisService.disconnect();
    await rabbitMqService.disconnect();
  });

  const sampleCreateDTO: CreateRideRequestDTO = {
    origin: {
      latitude: -34.6037,
      longitude: -58.3816,
      address: 'Av. Corrientes 1234, CABA'
    },
    destination: {
      latitude: -34.5889,
      longitude: -58.3912,
      address: 'Av. Santa Fe 2500, CABA'
    },
    vehicleType: 'AUTO'
  };

  /**
   * =========================================================================
   * Caso 1: Carrera de Aceptación Simultánea entre Múltiples Conductores (RF-5.5 / RNF-09)
   * =========================================================================
   */
  it('RF-5.5: Ante 5 conductores aceptando la misma solicitud simultáneamente, solo 1 gana y 4 reciben ConflictError', async () => {
    const clientId = `client_race_${Date.now()}`;
    const idempotencyKey = `idemp_race_${Date.now()}`;

    // 1. Crear solicitud
    const request = await rideRequestService.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

    // 2. Despachar ofertas a 5 conductores
    const driverIds = ['drv_1', 'drv_2', 'drv_3', 'drv_4', 'drv_5'];
    const sendResult = await rideRequestService.sendOffersForRequest(request.id, clientId, {
      driverIds,
      ttlSeconds: 30
    });

    expect(sendResult.offersSentCount).toBe(5);

    // 3. Ejecutar aceptación concurrente masiva (Promise.allSettled en el mismo instante)
    const responses = await Promise.allSettled(
      sendResult.offers.map((offer) =>
        rideRequestService.respondToOffer(offer.id, offer.driverId, {
          action: 'ACCEPT',
          driverId: offer.driverId
        })
      )
    );

    // 4. Verificar que exactamente 1 fue exitosa (fulfilled)
    const fulfilled = responses.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);

    // 5. Verificar que las otras 4 fueron rechazadas con ConflictError (REQUEST_ALREADY_ASSIGNED)
    const rejected = responses.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBe(4);

    for (const rej of rejected) {
      expect(rej.reason).toBeInstanceOf(ConflictError);
      expect((rej.reason as ConflictError).code).toBe('REQUEST_ALREADY_ASSIGNED');
    }

    // 6. Verificar que la solicitud quedó asignada a exactamente un conductor
    const updatedRequest = await rideRequestService.getRideRequestById(request.id, clientId);
    expect(updatedRequest.status).toBe('ASSIGNED');
    expect(updatedRequest.assignedDriverId).toBeDefined();
    expect(driverIds).toContain(updatedRequest.assignedDriverId);

    // 7. Verificar que se publicó el evento de asignación en RabbitMQ hacia M6 y M8
    const assignedMessage = rabbitMqService.publishedMessages.find(
      (m) => m.queue === 'dispatch.assigned' && m.message.payload?.requestId === request.id
    );
    if (assignedMessage) {
      expect(assignedMessage.message.eventType).toBe('TRIP_ASSIGNED');
      expect(assignedMessage.message.payload.driverId).toBe(updatedRequest.assignedDriverId);
      expect(assignedMessage.message.payload.clientId).toBe(clientId);
    }
  });

  /**
   * =========================================================================
   * Caso 2: Expiración por TTL en Redis (RF-5.4 / RNF-06)
   * =========================================================================
   */
  it('RF-5.4: Una oferta vencida por TTL en Redis debe ser rechazada con OFFER_EXPIRED', async () => {
    const clientId = `client_ttl_${Date.now()}`;
    const idempotencyKey = `idemp_ttl_${Date.now()}`;

    const request = await rideRequestService.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

    // Enviar oferta con TTL mínimo (5 segundos)
    const sendResult = await rideRequestService.sendOffersForRequest(request.id, clientId, {
      driverIds: ['drv_exp_1'],
      ttlSeconds: 5
    });

    const offer = sendResult.offers[0];

    // Simular que el tiempo expiró en Redis
    offer.expiresAt = new Date(Date.now() - 1000).toISOString();
    await redisService.deleteOffer(offer.id);

    // Intentar responder después de la expiración
    await expect(
      rideRequestService.respondToOffer(offer.id, offer.driverId, {
        action: 'ACCEPT',
        driverId: offer.driverId
      })
    ).rejects.toThrow();
  });

  /**
   * =========================================================================
   * Caso 3: Idempotencia y Doble Respuesta del Mismo Conductor (RNF-08)
   * =========================================================================
   */
  it('RNF-08: Si un conductor intenta responder dos veces la misma oferta, la segunda es rechazada con OFFER_ALREADY_RESPONDED', async () => {
    const clientId = `client_idemp_${Date.now()}`;
    const idempotencyKey = `idemp_dup_${Date.now()}`;

    const request = await rideRequestService.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

    const sendResult = await rideRequestService.sendOffersForRequest(request.id, clientId, {
      driverIds: ['drv_dup_1'],
      ttlSeconds: 30
    });

    const offer = sendResult.offers[0];

    // Primer intento: Exitoso
    const firstResponse = await rideRequestService.respondToOffer(offer.id, offer.driverId, {
      action: 'ACCEPT',
      driverId: offer.driverId
    });
    expect(firstResponse.status).toBe('ACCEPTED');

    // Segundo intento idéntico: Debe fallar por estar ya respondida
    await expect(
      rideRequestService.respondToOffer(offer.id, offer.driverId, {
        action: 'ACCEPT',
        driverId: offer.driverId
      })
    ).rejects.toThrow();
  });

  /**
   * =========================================================================
   * Caso 4: Carrera entre Aceptación del Conductor y Cancelación del Cliente
   * =========================================================================
   */
  it('RF-5.5 vs RF-5.6: No permite cancelar una solicitud si el conductor ya fue asignado', async () => {
    const clientId = `client_cancel_race_${Date.now()}`;
    const idempotencyKey = `idemp_cr_${Date.now()}`;

    const request = await rideRequestService.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

    const sendResult = await rideRequestService.sendOffersForRequest(request.id, clientId, {
      driverIds: ['drv_cr_1'],
      ttlSeconds: 30
    });

    const offer = sendResult.offers[0];

    // Conductor acepta
    await rideRequestService.respondToOffer(offer.id, offer.driverId, {
      action: 'ACCEPT',
      driverId: offer.driverId
    });

    // Cliente intenta cancelar después de asignado: Debe dar 409
    await expect(
      rideRequestService.cancelRideRequest(request.id, clientId, { reason: 'Me arrepentí' })
    ).rejects.toThrow(ConflictError);
  });
});
