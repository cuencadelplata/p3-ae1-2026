import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RideRequestService } from '../../src/services/ride-request.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { DriverCancellationEvent } from '../../src/types/ride-request.types';
import { RedisService } from '../../src/services/redis.service';
import { M4ClientService } from '../../src/services/m4-client.service';
import { RideOffer } from '../../src/types/ride-request.types';

describe('Integración RabbitMQ - Cola despacho.reabrir (Cancelación por Conductor)', () => {
  let rideRequestService: RideRequestService;
  let rabbitMQService: RabbitMQService;
  let redisService: RedisService;
  let m4Client: M4ClientService;

  beforeEach(() => {
    // Forzar modo simulación en memoria para tests veloces sin dependencias externas
    process.env.DISABLE_REDIS = 'true';
    process.env.DISABLE_RABBITMQ = 'true';
    process.env.M4_MOCK = 'true';

    redisService = new RedisService();
    rabbitMQService = new RabbitMQService();

    // Corrección RF-5.2: Se usan mocks sembrados explícitamente (aprobados)
    m4Client = new M4ClientService();
    m4Client.seedMockDrivers([
      { driverId: 'conductor-789', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 1.0, rating: 4.8 },
      { driverId: 'drv_101', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_102', latitude: -34.607, longitude: -58.385, vehicleType: 'AUTO', available: true, distanceKm: 2.1, rating: 4.6 },
    ]);

    rideRequestService = new RideRequestService(redisService, rabbitMQService, m4Client, false);
    jest.spyOn(rideRequestService as any, 'notifyM6TripAssigned').mockResolvedValue('trip-test');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    delete process.env.M4_MOCK;
    m4Client.clearMockDrivers();
    await redisService.disconnect();
    await rabbitMQService.close();
  });

  it('debe recibir el evento de Lucas en despacho.reabrir y relanzar ofertas excluyendo al conductor que canceló', async () => {
    // 1. Crear una solicitud de viaje
    const request = await rideRequestService.createRideRequest(
      'cliente-456',
      'idemp-test-reopen-1',
      {
        origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
        destination: { latitude: -34.5885, longitude: -58.4045, address: 'Recoleta' },
        vehicleType: 'AUTO'
      }
    );

    // 2. Enviar oferta y simular que el conductor "conductor-789" había tomado el viaje
    const offersResult = await rideRequestService.sendOffersForRequest(request.id, 'cliente-456', {
      driverIds: ['conductor-789'],
      ttlSeconds: 30
    });
    const offerId = offersResult.offers[0].id;

    // Conductor acepta
    await rideRequestService.respondToOffer(offerId, 'conductor-789', {
      action: 'ACCEPT',
      driverId: 'conductor-789'
    });

    const assignedRequest = await rideRequestService.getRideRequestById(request.id, 'cliente-456');
    expect(assignedRequest.status).toBe('ASSIGNED');
    expect(assignedRequest.assignedDriverId).toBe('conductor-789');

    // 3. Simular el mensaje que manda Lucas por RabbitMQ en la cola despacho.reabrir
    const cancellationPayload: DriverCancellationEvent = {
      viajeId: request.id,
      clienteId: 'cliente-456',
      conductorId: 'conductor-789',
      motivo: 'El conductor canceló el viaje',
      evento: 'cancelacion_conductor',
      timestamp: '2026-09-28T01:00:00.000Z'
    };

    // Publicar el evento (en modo simulación lo despacha al suscriptor automáticamente)
    await rabbitMQService.publishDriverCancellation(cancellationPayload);

    // 4. Verificar que la solicitud fue reabierta
    const updatedRequest = await rideRequestService.getRideRequestById(request.id, 'cliente-456');
    expect(updatedRequest.assignedDriverId).toBeNull();
    // Como encontró nuevos candidatos (del mock de M4), emitió nuevas ofertas y pasó a OFFERED
    expect(['SEARCHING', 'OFFERED']).toContain(updatedRequest.status);

    // 5. Verificar que las nuevas ofertas emitidas NO incluyan a conductor-789
    const allOffers: RideOffer[] = await rideRequestService.getAllOffers();
    const newPendingOffers = allOffers.filter((o) => o.requestId === request.id && o.status === 'PENDING');

    expect(newPendingOffers.length).toBeGreaterThan(0);
    for (const offer of newPendingOffers) {
      expect(offer.driverId).not.toBe('conductor-789');
    }

    // La oferta debe poder aceptarse antes de que venza el candado anterior (30 s).
    const replacement = newPendingOffers[0];
    const accepted = await rideRequestService.respondToOffer(replacement.id, replacement.driverId, {
      action: 'ACCEPT', driverId: replacement.driverId
    });
    expect(accepted.requestStatus).toBe('ASSIGNED');
    expect(accepted.assignedDriverId).toBe(replacement.driverId);
    // La reasignación conserva la exclusividad frente a otro candidato.
    const other = newPendingOffers.find((o) => o.driverId !== replacement.driverId);
    expect(other).toBeDefined();
    await expect(rideRequestService.respondToOffer(other!.id, other!.driverId, {
      action: 'ACCEPT', driverId: other!.driverId
    })).rejects.toThrow();

  });

  it('permite que otro conductor acepte cuando el primero solo rechazó la oferta', async () => {
    const request = await rideRequestService.createRideRequest('cliente-rechazo', 'idemp-rechazo', {
      origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
      destination: { latitude: -34.5885, longitude: -58.4045, address: 'Recoleta' },
      vehicleType: 'AUTO'
    });
    const { offers } = await rideRequestService.sendOffersForRequest(request.id, 'cliente-rechazo', {
      driverIds: ['conductor-789', 'drv_101'], ttlSeconds: 30
    });
    await rideRequestService.respondToOffer(offers[0].id, offers[0].driverId, {
      action: 'REJECT', driverId: offers[0].driverId
    });
    const accepted = await rideRequestService.respondToOffer(offers[1].id, offers[1].driverId, {
      action: 'ACCEPT', driverId: offers[1].driverId
    });
    expect(accepted.requestStatus).toBe('ASSIGNED');
    expect(accepted.assignedDriverId).toBe('drv_101');
  });

  it('debe manejar graciosamente un viajeId inexistente sin arrojar errores', async () => {
    const invalidPayload: DriverCancellationEvent = {
      viajeId: 'viaje-inexistente-999',
      clienteId: 'cliente-456',
      conductorId: 'conductor-789',
      motivo: 'El conductor canceló el viaje',
      evento: 'cancelacion_conductor',
      timestamp: '2026-09-28T01:00:00.000Z'
    };

    // No debe lanzar excepciones
    await expect(rabbitMQService.publishDriverCancellation(invalidPayload)).resolves.toBe(true);
  });
});
