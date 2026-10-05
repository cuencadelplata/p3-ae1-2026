import { RideRequestService, ConflictError, ValidationError } from '../../src/services/ride-request.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { CreateRideRequestDTO, RideRequestCancelledEvent } from '../../src/types/ride-request.types';

describe('RF-5.6: Cancelación previa de solicitud con Redis y RabbitMQ (AE2)', () => {
  let service: RideRequestService;
  let redisService: RedisService;
  let rabbitmqService: RabbitMQService;

  const validCreateDTO: CreateRideRequestDTO = {
    origin: {
      latitude: -34.6037,
      longitude: -58.3816,
      address: 'Av. 9 de Julio y Corrientes'
    },
    destination: {
      latitude: -34.5875,
      longitude: -58.3974,
      address: 'Av. Alvear 1891'
    },
    vehicleType: 'AUTO'
  };

  beforeEach(() => {
    redisService = new RedisService();
    rabbitmqService = new RabbitMQService();
    service = new RideRequestService(redisService, rabbitmqService);
  });

  afterEach(async () => {
    await redisService.disconnect();
    await rabbitmqService.close();
  });

  test('debe cancelar exitosamente una solicitud de viaje en estado SEARCHING', async () => {
    const request = await service.createRideRequest('client_101', 'idemp_key_1', validCreateDTO);
    expect(request.status).toBe('SEARCHING');

    const cancelResult = await service.cancelRideRequest(request.id, 'client_101', {
      reason: 'Cambié de planes'
    });

    expect(cancelResult.status).toBe('CANCELLED');
    expect(cancelResult.requestId).toBe(request.id);
    expect(cancelResult.clientId).toBe('client_101');
    expect(cancelResult.reason).toBe('Cambié de planes');
    expect(cancelResult.cancelledAt).toBeDefined();

    // Comprobar estado actualizado en el servicio
    const updated = await service.getRideRequestById(request.id, 'client_101');
    expect(updated.status).toBe('CANCELLED');
    expect(updated.cancelledAt).toBeDefined();
  });

  test('debe invalidar en Redis todas las ofertas activas cuando el cliente cancela la solicitud', async () => {
    const request = await service.createRideRequest('client_102', 'idemp_key_2', validCreateDTO);

    // Enviar ofertas con TTL
    const offersResponse = await service.sendOffersForRequest(request.id, 'client_102', {
      driverIds: ['drv_1', 'drv_2'],
      ttlSeconds: 45
    });

    const offerId1 = offersResponse.offers[0].id;
    const offerId2 = offersResponse.offers[1].id;

    // Verificar que las ofertas existan en Redis antes de la cancelación
    const redisOffer1Before = await redisService.getOffer(offerId1);
    expect(redisOffer1Before).not.toBeNull();
    expect(redisOffer1Before?.id).toBe(offerId1);

    // Cancelar la solicitud
    await service.cancelRideRequest(request.id, 'client_102', { reason: 'Demora excesiva' });

    // Verificar que las ofertas fueron borradas/invalidadas de Redis
    const redisOffer1After = await redisService.getOffer(offerId1);
    const redisOffer2After = await redisService.getOffer(offerId2);
    expect(redisOffer1After).toBeNull();
    expect(redisOffer2After).toBeNull();

    // Verificar que Redis tiene la bandera de solicitud cancelada
    const isCancelledInRedis = await redisService.isRequestCancelled(request.id);
    expect(isCancelledInRedis).toBe(true);
  });

  test('debe publicar el evento asíncrono en RabbitMQ al cancelar la solicitud', async () => {
    const publishedEvents: RideRequestCancelledEvent[] = [];

    // Suscribirse a la cola de cancelaciones
    await rabbitmqService.subscribeToCancelledRequests(async (event) => {
      publishedEvents.push(event);
    });

    const request = await service.createRideRequest('client_103', 'idemp_key_3', validCreateDTO);
    await service.sendOffersForRequest(request.id, 'client_103', {
      driverIds: ['drv_10', 'drv_20'],
      ttlSeconds: 60
    });

    await service.cancelRideRequest(request.id, 'client_103', {
      reason: 'Encontré otro transporte'
    });

    // Validar evento recibido por el consumidor
    expect(publishedEvents.length).toBe(1);
    const event = publishedEvents[0];
    expect(event.eventType).toBe('RIDE_REQUEST_CANCELLED');
    expect(event.requestId).toBe(request.id);
    expect(event.clientId).toBe('client_103');
    expect(event.reason).toBe('Encontré otro transporte');
    expect(event.affectedDriverIds).toEqual(['drv_10', 'drv_20']);
    expect(event.correlationId).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  test('debe registrar el evento inmutable de auditoría para trazabilidad y propiedad de datos (RNF-04)', async () => {
    const request = await service.createRideRequest('client_104', 'idemp_key_4', validCreateDTO);
    await service.cancelRideRequest(request.id, 'client_104', { reason: 'Test auditoría' });

    const auditLogs = service.getAuditEvents(request.id);
    expect(auditLogs.length).toBeGreaterThanOrEqual(2);

    const cancelEvent = auditLogs.find((evt) => evt.eventType === 'CANCELLED_BY_CLIENT');
    expect(cancelEvent).toBeDefined();
    expect(cancelEvent?.actorId).toBe('client_104');
    expect(cancelEvent?.actorType).toBe('CLIENT');
    expect(cancelEvent?.payload).toMatchObject({
      reason: 'Test auditoría'
    });
  });

  test('Carrera de concurrencia: si el cliente cancela, el conductor no puede aceptar la oferta (409 Conflict)', async () => {
    const request = await service.createRideRequest('client_105', 'idemp_key_5', validCreateDTO);
    const offersRes = await service.sendOffersForRequest(request.id, 'client_105', {
      driverIds: ['drv_racing_1'],
      ttlSeconds: 60
    });
    const offerId = offersRes.offers[0].id;

    // 1. Cliente cancela primero
    await service.cancelRideRequest(request.id, 'client_105', { reason: 'Cancelado a tiempo' });

    // 2. Conductor intenta aceptar la oferta cancelada
    await expect(
      service.respondToOffer(offerId, 'drv_racing_1', { action: 'ACCEPT' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.respondToOffer(offerId, 'drv_racing_1', { action: 'ACCEPT' });
    } catch (err) {
      expect((err as ConflictError).code).toBe('REQUEST_CANCELLED');
    }
  });

  test('Carrera de concurrencia: si el conductor acepta primero, el cliente ya no puede cancelar previamente', async () => {
    const request = await service.createRideRequest('client_106', 'idemp_key_6', validCreateDTO);
    const offersRes = await service.sendOffersForRequest(request.id, 'client_106', {
      driverIds: ['drv_winner_1'],
      ttlSeconds: 60
    });
    const offerId = offersRes.offers[0].id;

    // 1. Conductor acepta primero
    const acceptRes = await service.respondToOffer(offerId, 'drv_winner_1', { action: 'ACCEPT' });
    expect(acceptRes.status).toBe('ACCEPTED');

    // 2. Cliente intenta cancelar una solicitud que ya está ASSIGNED
    await expect(
      service.cancelRideRequest(request.id, 'client_106', { reason: 'Quiero cancelar' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.cancelRideRequest(request.id, 'client_106', { reason: 'Quiero cancelar' });
    } catch (err) {
      expect((err as ConflictError).code).toBe('REQUEST_ALREADY_ASSIGNED');
    }
  });

  test('Resolución atómica ante solicitudes concurrentes con Promise.all (Criterio 7 / RNF-09)', async () => {
    const request = await service.createRideRequest('client_107', 'idemp_key_7', validCreateDTO);
    const offersRes = await service.sendOffersForRequest(request.id, 'client_107', {
      driverIds: ['drv_conc_1'],
      ttlSeconds: 60
    });
    const offerId = offersRes.offers[0].id;

    // Disparar simultáneamente cancelación por cliente y aceptación por conductor
    const results = await Promise.allSettled([
      service.cancelRideRequest(request.id, 'client_107', { reason: 'Carrera sim' }),
      service.respondToOffer(offerId, 'drv_conc_1', { action: 'ACCEPT' })
    ]);

    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = results.filter((r) => r.status === 'rejected').length;

    // Exactamente una operación debe ganar y la otra debe ser rechazada por conflicto
    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const finalReq = await service.getRideRequestById(request.id, 'client_107');
    expect(['CANCELLED', 'ASSIGNED']).toContain(finalReq.status);
  });

  test('debe rechazar cancelación si el motivo excede 255 caracteres', async () => {
    const request = await service.createRideRequest('client_108', 'idemp_key_8', validCreateDTO);
    const longReason = 'a'.repeat(256);

    await expect(
      service.cancelRideRequest(request.id, 'client_108', { reason: longReason })
    ).rejects.toThrow(ValidationError);
  });

  test('debe rechazar cancelación si la solicitud ya está cancelada', async () => {
    const request = await service.createRideRequest('client_109', 'idemp_key_9', validCreateDTO);
    await service.cancelRideRequest(request.id, 'client_109', { reason: 'Primera' });

    await expect(
      service.cancelRideRequest(request.id, 'client_109', { reason: 'Segunda vez' })
    ).rejects.toThrow(ConflictError);
  });
});
