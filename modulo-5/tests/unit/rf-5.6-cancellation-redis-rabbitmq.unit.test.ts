import { RideRequestService, ConflictError, ValidationError } from '../../src/services/ride-request.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { DbService } from '../../src/services/db.service';
import { CreateRideRequestDTO, RideRequestCancelledEvent } from '../../src/types/ride-request.types';

describe('RF-5.6: Cancelación previa de solicitud con Redis, RabbitMQ y Persistencia Relacional (AE2)', () => {
  let service: RideRequestService;
  let redisService: RedisService;
  let rabbitmqService: RabbitMQService;
  let dbService: DbService;

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
    dbService = new DbService();
    service = new RideRequestService(redisService, rabbitmqService, undefined, dbService);
  });

  afterEach(async () => {
    await redisService.disconnect();
    await rabbitmqService.close();
    await dbService.disconnect();
  });

  // ==========================================================================
  // CP-5.6-01: Cancelar antes de ofertar (Alcance: Básico)
  // ==========================================================================
  test('CP-5.6-01: Crear una solicitud propia y cancelarla antes de enviar ofertas. La solicitud queda cancelada y no se asigna ningún conductor', async () => {
    const request = await service.createRideRequest('client_cp01', 'idemp_key_cp01', validCreateDTO);
    expect(request.status).toBe('SEARCHING');
    expect(request.assignedDriverId).toBeNull();

    // Cancelar antes de que se emitan ofertas
    const cancelResult = await service.cancelRideRequest(request.id, 'client_cp01', {
      reason: 'Ya no necesito el viaje'
    });

    expect(cancelResult.status).toBe('CANCELLED');
    expect(cancelResult.requestId).toBe(request.id);
    expect(cancelResult.clientId).toBe('client_cp01');
    expect(cancelResult.cancelledAt).toBeDefined();

    // Comprobar estado final en memoria y en persistencia DbService
    const updated = await service.getRideRequestById(request.id, 'client_cp01');
    expect(updated.status).toBe('CANCELLED');
    expect(updated.assignedDriverId).toBeNull();

    const dbSaved = await dbService.getRideRequestById(request.id);
    expect(dbSaved?.status).toBe('CANCELLED');
    expect(dbSaved?.assignedDriverId).toBeNull();
  });

  // ==========================================================================
  // CP-5.6-02: Cancelar e invalidar las ofertas (Alcance: Básico)
  // ==========================================================================
  test('CP-5.6-02: Cancelar una solicitud con ofertas pendientes. Luego intentar aceptar una de esas ofertas con su ID anterior', async () => {
    const request = await service.createRideRequest('client_cp02', 'idemp_key_cp02', validCreateDTO);

    // Enviar ofertas a conductores
    const offersResponse = await service.sendOffersForRequest(request.id, 'client_cp02', {
      driverIds: ['drv_cp02_1', 'drv_cp02_2'],
      ttlSeconds: 45
    });

    const offerId1 = offersResponse.offers[0].id;
    const offerId2 = offersResponse.offers[1].id;

    // Verificar ofertas presentes en Redis antes de cancelar
    expect(await redisService.getOffer(offerId1)).not.toBeNull();
    expect(await redisService.getOffer(offerId2)).not.toBeNull();

    // Cancelar la solicitud
    await service.cancelRideRequest(request.id, 'client_cp02', { reason: 'Demora excesiva' });

    // Ofertas eliminadas de Redis y bandera de cancelación activa
    expect(await redisService.getOffer(offerId1)).toBeNull();
    expect(await redisService.getOffer(offerId2)).toBeNull();
    expect(await redisService.isRequestCancelled(request.id)).toBe(true);

    // Conductor intenta aceptar la oferta anterior
    await expect(
      service.respondToOffer(offerId1, 'drv_cp02_1', { action: 'ACCEPT' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.respondToOffer(offerId1, 'drv_cp02_1', { action: 'ACCEPT' });
    } catch (err) {
      expect((err as ConflictError).code).toBe('REQUEST_CANCELLED');
    }

    // La solicitud permanece CANCELLED y sin conductor asignado
    const finalRequest = await service.getRideRequestById(request.id, 'client_cp02');
    expect(finalRequest.status).toBe('CANCELLED');
    expect(finalRequest.assignedDriverId).toBeNull();
  });

  // ==========================================================================
  // CP-5.6-06: Cancelar una solicitud ajena (Alcance: Seguridad)
  // ==========================================================================
  test('CP-5.6-06: Con sesión de B, intentar cancelar la solicitud de A enviando el ID de cliente A. Se deniega la operación y A no cambia', async () => {
    const requestA = await service.createRideRequest('client_A', 'idemp_key_user_A', validCreateDTO);
    expect(requestA.clientId).toBe('client_A');
    expect(requestA.status).toBe('SEARCHING');

    // Sesión de B intenta cancelar solicitud perteneciente a A
    await expect(
      service.cancelRideRequest(requestA.id, 'client_B', { reason: 'Intento malicioso de B' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.cancelRideRequest(requestA.id, 'client_B', { reason: 'Intento malicioso de B' });
    } catch (err) {
      expect((err as ConflictError).code).toBe('FORBIDDEN_ACCESS');
    }

    // Comprobar que la solicitud de A permanece intacta en SEARCHING
    const unchanged = await service.getRideRequestById(requestA.id, 'client_A');
    expect(unchanged.status).toBe('SEARCHING');
    expect(unchanged.cancelledAt).toBeUndefined();
  });

  // ==========================================================================
  // CP-5.6-09: Repetir una cancelación (Alcance: Reintentos / Idempotencia)
  // ==========================================================================
  test('CP-5.6-09: Anotar respuesta al repetir cancelación. Cancelar y repetir exactamente el mismo pedido; no se duplican efectos', async () => {
    const request = await service.createRideRequest('client_cp09', 'idemp_key_cp09', validCreateDTO);

    // Primera cancelación exitosa
    const firstCancel = await service.cancelRideRequest(request.id, 'client_cp09', {
      reason: 'Mismo motivo'
    });
    expect(firstCancel.status).toBe('CANCELLED');

    // Registrar eventos emitidos hasta ahora
    const auditCountAfterFirst = service.getAuditEvents(request.id).length;

    // Repetir exactamente la misma petición de cancelación
    await expect(
      service.cancelRideRequest(request.id, 'client_cp09', { reason: 'Mismo motivo' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.cancelRideRequest(request.id, 'client_cp09', { reason: 'Mismo motivo' });
    } catch (err) {
      // Regla acordada del contrato: 409 REQUEST_ALREADY_CANCELLED
      expect((err as ConflictError).code).toBe('REQUEST_ALREADY_CANCELLED');
    }

    // La solicitud sigue cancelada y no se duplican efectos de auditoría
    const finalReq = await service.getRideRequestById(request.id, 'client_cp09');
    expect(finalReq.status).toBe('CANCELLED');
    expect(service.getAuditEvents(request.id).length).toBe(auditCountAfterFirst);
  });

  // ==========================================================================
  // CP-5.6-10: Cancelar después de asignar (Alcance: Regla a confirmar)
  // ==========================================================================
  test('CP-5.6-10: Regla: No se permite cancelación previa después de asignar. Se rechaza con 409 y se conserva la asignación', async () => {
    // REGLA ESCRITA Y DEFINIDA:
    // La cancelación previa (RF-5.6) solo aplica en fases PENDING, SEARCHING u OFFERED.
    // Una vez concretada la asignación (ASSIGNED), se rechaza la cancelación previa con 409 Conflict (REQUEST_ALREADY_ASSIGNED)
    // y se conserva la asignación y el conductor intactos.

    const request = await service.createRideRequest('client_cp10', 'idemp_key_cp10', validCreateDTO);
    const offersRes = await service.sendOffersForRequest(request.id, 'client_cp10', {
      driverIds: ['drv_assigned_10'],
      ttlSeconds: 60
    });
    const offerId = offersRes.offers[0].id;

    // Conductor acepta y queda asignado
    const acceptRes = await service.respondToOffer(offerId, 'drv_assigned_10', { action: 'ACCEPT' });
    expect(acceptRes.status).toBe('ACCEPTED');

    // Pasajero intenta cancelar previamente
    await expect(
      service.cancelRideRequest(request.id, 'client_cp10', { reason: 'Llegué tarde' })
    ).rejects.toThrow(ConflictError);

    try {
      await service.cancelRideRequest(request.id, 'client_cp10', { reason: 'Llegué tarde' });
    } catch (err) {
      expect((err as ConflictError).code).toBe('REQUEST_ALREADY_ASSIGNED');
    }

    // Verificar solicitud, conductor asignado y que ninguna oferta anterior permite reactivar
    const postReq = await service.getRideRequestById(request.id, 'client_cp10');
    expect(postReq.status).toBe('ASSIGNED');
    expect(postReq.assignedDriverId).toBe('drv_assigned_10');

    // Intentar reaccionar con la oferta anterior debe fallar
    await expect(
      service.respondToOffer(offerId, 'drv_assigned_10', { action: 'ACCEPT' })
    ).rejects.toThrow(ConflictError);
  });

  // ==========================================================================
  // CP-5.6-12: Aceptar y cancelar juntos (Alcance: Concurrencia crítica)
  // ==========================================================================
  describe('CP-5.6-12: Concurrencia crítica (Aceptar y cancelar juntos)', () => {
    test('Carrera paralela: si gana la cancelación, el conductor recibe 409 REQUEST_CANCELLED', async () => {
      const request = await service.createRideRequest('client_c12_a', 'idemp_key_c12_a', validCreateDTO);
      const offersRes = await service.sendOffersForRequest(request.id, 'client_c12_a', {
        driverIds: ['drv_c12_a'],
        ttlSeconds: 60
      });
      const offerId = offersRes.offers[0].id;

      // Cancelación confirmada primero
      await service.cancelRideRequest(request.id, 'client_c12_a', { reason: 'Cancelo primero' });

      // Intento de aceptación posterior
      await expect(
        service.respondToOffer(offerId, 'drv_c12_a', { action: 'ACCEPT' })
      ).rejects.toThrow(ConflictError);

      try {
        await service.respondToOffer(offerId, 'drv_c12_a', { action: 'ACCEPT' });
      } catch (err) {
        expect((err as ConflictError).code).toBe('REQUEST_CANCELLED');
      }

      const finalReq = await service.getRideRequestById(request.id, 'client_c12_a');
      expect(finalReq.status).toBe('CANCELLED');
      expect(finalReq.assignedDriverId).toBeNull();
    });

    test('Carrera paralela: si gana la asignación, la cancelación recibe 409 REQUEST_ALREADY_ASSIGNED', async () => {
      const request = await service.createRideRequest('client_c12_b', 'idemp_key_c12_b', validCreateDTO);
      const offersRes = await service.sendOffersForRequest(request.id, 'client_c12_b', {
        driverIds: ['drv_c12_b'],
        ttlSeconds: 60
      });
      const offerId = offersRes.offers[0].id;

      // Asignación confirmada primero
      const acceptRes = await service.respondToOffer(offerId, 'drv_c12_b', { action: 'ACCEPT' });
      expect(acceptRes.status).toBe('ACCEPTED');

      // Intento de cancelación posterior
      await expect(
        service.cancelRideRequest(request.id, 'client_c12_b', { reason: 'Cancelo tarde' })
      ).rejects.toThrow(ConflictError);

      try {
        await service.cancelRideRequest(request.id, 'client_c12_b', { reason: 'Cancelo tarde' });
      } catch (err) {
        expect((err as ConflictError).code).toBe('REQUEST_ALREADY_ASSIGNED');
      }

      const finalReq = await service.getRideRequestById(request.id, 'client_c12_b');
      expect(finalReq.status).toBe('ASSIGNED');
      expect(finalReq.assignedDriverId).toBe('drv_c12_b');
    });

    test('Lanzar aceptación y cancelación en paralelo mediante Promise.allSettled', async () => {
      const request = await service.createRideRequest('client_c12_c', 'idemp_key_c12_c', validCreateDTO);
      const offersRes = await service.sendOffersForRequest(request.id, 'client_c12_c', {
        driverIds: ['drv_c12_c'],
        ttlSeconds: 60
      });
      const offerId = offersRes.offers[0].id;

      // Disparar ambas operaciones en simultáneo
      const results = await Promise.allSettled([
        service.cancelRideRequest(request.id, 'client_c12_c', { reason: 'Carrera simultánea' }),
        service.respondToOffer(offerId, 'drv_c12_c', { action: 'ACCEPT' })
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactamente una operación debe ganar y la otra debe ser rechazada por conflicto
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const finalReq = await service.getRideRequestById(request.id, 'client_c12_c');
      expect(['CANCELLED', 'ASSIGNED']).toContain(finalReq.status);

      if (finalReq.status === 'CANCELLED') {
        expect(finalReq.assignedDriverId).toBeNull();
      } else {
        expect(finalReq.assignedDriverId).toBe('drv_c12_c');
      }
    });
  });

  // ==========================================================================
  // CP-5.6-19: Volver a pedir después de cancelar (Alcance: Regresión)
  // ==========================================================================
  test('CP-5.6-19: Cancelar una solicitud propia antes de asignar y, luego, crear otra con datos válidos y nueva clave', async () => {
    // 1. Crear y cancelar primera solicitud
    const req1 = await service.createRideRequest('client_cp19', 'idemp_key_req1', validCreateDTO);
    expect(req1.status).toBe('SEARCHING');

    await service.cancelRideRequest(req1.id, 'client_cp19', { reason: 'Me equivoqué de destino' });
    const req1Check = await service.getRideRequestById(req1.id, 'client_cp19');
    expect(req1Check.status).toBe('CANCELLED');

    // 2. Crear una nueva solicitud con nueva clave de idempotencia
    const newDestinationDTO: CreateRideRequestDTO = {
      ...validCreateDTO,
      destination: {
        latitude: -34.5711,
        longitude: -58.4233,
        address: 'Plaza Italia, Palermo'
      }
    };

    const req2 = await service.createRideRequest('client_cp19', 'idemp_key_req2', newDestinationDTO);
    expect(req2.id).not.toBe(req1.id);
    expect(req2.status).toBe('SEARCHING');
    expect(req2.destination.address).toBe('Plaza Italia, Palermo');

    // 3. Comprobar que la solicitud anterior sigue cancelada y la nueva está activa
    const req1Final = await service.getRideRequestById(req1.id, 'client_cp19');
    const req2Final = await service.getRideRequestById(req2.id, 'client_cp19');
    expect(req1Final.status).toBe('CANCELLED');
    expect(req2Final.status).toBe('SEARCHING');
  });

  // ==========================================================================
  // Control de Lock Adquirido y Tolerancia a Fallos
  // ==========================================================================
  describe('Exigir lock adquirido (Qué falta)', () => {
    test('debe exigir lock adquirido: si no se consigue el lock, rechaza con ConflictError y no cancela', async () => {
      const request = await service.createRideRequest('client_lock_test', 'idemp_key_lock_1', validCreateDTO);

      // Simular que el lock ya está adquirido por otro proceso concurrente
      const mockAcquire = jest.spyOn(redisService, 'acquireLock').mockResolvedValue(false);

      await expect(
        service.cancelRideRequest(request.id, 'client_lock_test', { reason: 'Falla lock' })
      ).rejects.toThrow(ConflictError);

      try {
        await service.cancelRideRequest(request.id, 'client_lock_test', { reason: 'Falla lock' });
      } catch (err) {
        expect((err as ConflictError).code).toBe('LOCK_ACQUISITION_FAILED');
      }

      mockAcquire.mockRestore();

      // Comprobar que la solicitud no fue cancelada y sigue en SEARCHING
      const unchanged = await service.getRideRequestById(request.id, 'client_lock_test');
      expect(unchanged.status).toBe('SEARCHING');
    });

    test('no debe liberar locks ajenos si la adquisición falló', async () => {
      const request = await service.createRideRequest('client_lock_test2', 'idemp_key_lock_2', validCreateDTO);

      const mockAcquire = jest.spyOn(redisService, 'acquireLock').mockResolvedValue(false);
      const mockRelease = jest.spyOn(redisService, 'releaseLock');

      await expect(
        service.cancelRideRequest(request.id, 'client_lock_test2', { reason: 'No lock' })
      ).rejects.toThrow(ConflictError);

      expect(mockRelease).not.toHaveBeenCalled();

      mockAcquire.mockRestore();
      mockRelease.mockRestore();
    });
  });

  // ==========================================================================
  // Persistencia del Cambio en DbService (Qué falta)
  // ==========================================================================
  describe('Persistir el cambio en DbService (Qué falta)', () => {
    test('debe persistir el cambio de estado a CANCELLED y el evento de auditoría en PostgreSQL (DbService)', async () => {
      const request = await service.createRideRequest('client_db_test', 'idemp_key_db_1', validCreateDTO);

      // Verificar que se haya guardado inicialmente en DbService
      const initialDb = await dbService.getRideRequestById(request.id);
      expect(initialDb).not.toBeNull();
      expect(initialDb?.status).toBe('SEARCHING');

      // Cancelar solicitud
      await service.cancelRideRequest(request.id, 'client_db_test', {
        reason: 'Cancelación persistida en base de datos'
      });

      // Verificar que el estado actualizado en DbService es CANCELLED con sus metadatos
      const cancelledDb = await dbService.getRideRequestById(request.id);
      expect(cancelledDb).not.toBeNull();
      expect(cancelledDb?.status).toBe('CANCELLED');
      expect(cancelledDb?.cancelledAt).toBeDefined();
      expect(cancelledDb?.cancellationReason).toBe('Cancelación persistida en base de datos');

      // Verificar que se registró el log de auditoría
      const memoryLogs = dbService.getMemoryLogs();
      const cancelLog = memoryLogs.find(
        (l) => l.requestId === request.id && l.eventType === 'CANCELLED_BY_CLIENT'
      );
      expect(cancelLog).toBeDefined();
    });
  });

  // ==========================================================================
  // Validaciones y Casos Límite
  // ==========================================================================
  test('debe rechazar cancelación si el motivo excede 255 caracteres', async () => {
    const request = await service.createRideRequest('client_val_1', 'idemp_key_val_1', validCreateDTO);
    const longReason = 'x'.repeat(256);

    await expect(
      service.cancelRideRequest(request.id, 'client_val_1', { reason: longReason })
    ).rejects.toThrow(ValidationError);
  });

  test('debe publicar el evento asíncrono en RabbitMQ con esquema estándar al cancelar', async () => {
    const publishedEvents: RideRequestCancelledEvent[] = [];

    await rabbitmqService.subscribeToCancelledRequests(async (event) => {
      publishedEvents.push(event);
    });

    const request = await service.createRideRequest('client_rmq_1', 'idemp_key_rmq_1', validCreateDTO);
    await service.sendOffersForRequest(request.id, 'client_rmq_1', {
      driverIds: ['drv_rmq_1', 'drv_rmq_2'],
      ttlSeconds: 60
    });

    await service.cancelRideRequest(request.id, 'client_rmq_1', {
      reason: 'Evento asíncrono verificado'
    });

    expect(publishedEvents.length).toBe(1);
    const event = publishedEvents[0];
    expect(event.eventType).toBe('RIDE_REQUEST_CANCELLED');
    expect(event.requestId).toBe(request.id);
    expect(event.clientId).toBe('client_rmq_1');
    expect(event.reason).toBe('Evento asíncrono verificado');
    expect(event.affectedDriverIds).toEqual(['drv_rmq_1', 'drv_rmq_2']);
  });
});
