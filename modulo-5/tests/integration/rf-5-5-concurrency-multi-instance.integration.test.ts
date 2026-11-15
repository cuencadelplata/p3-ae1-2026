import { RideRequestService, ConflictError } from '../../src/services/ride-request.service';
import { DbService } from '../../src/services/db.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMqService } from '../../src/services/rabbitmq.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';

/**
 * Matriz Oficial de Casos de Prueba para RF-5.5: Asignación Única y Resolución Atómica
 * 
 * Casos cubiertos con ID de trazabilidad:
 * - CP-5.5-01: Dos conductores aceptan juntos (enviar las dos aceptaciones al mismo tiempo en paralelo).
 * - CP-5.5-03: Aceptación duplicada simultánea (enviar en paralelo dos copias de la misma oferta y conductor).
 * - CP-5.5-04: Otro conductor acepta después (asignar a A; después B intenta aceptar su oferta anterior).
 * - CP-5.5-12: No perder la asignación al reiniciar M5 (persistencia en DB compartida y rechazo a segunda asignación).
 * - Multi-Instancia: Concurrencia entre Instancia A e Instancia B sobre base de datos compartida.
 * - Resiliencia: Asignación atómica garantizada ante error o caída total de Redis.
 */
describe('RF-5.5: Casos de Prueba Oficiales — Asignación Única y Resolución Atómica', () => {
  let dbService: DbService;
  let redisService: RedisService;
  let rabbitMqService: RabbitMqService;
  let service: RideRequestService;

  beforeEach(() => {
    dbService = new DbService();
    redisService = new RedisService();
    rabbitMqService = new RabbitMqService();
    service = new RideRequestService(dbService, redisService, rabbitMqService);
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
      address: 'Av. Corrientes y 9 de Julio (Obelisco)'
    },
    destination: {
      latitude: -34.5885,
      longitude: -58.3974,
      address: 'Av. Alvear 1891 (Recoleta)'
    },
    vehicleType: 'AUTO'
  };

  const getUniqueClientId = () => `client_rf55_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const getUniqueKey = () => `key_rf55_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // ==========================================================================
  // CP-5.5-01: Dos conductores aceptan juntos
  // ==========================================================================
  it('CP-5.5-01: Con ofertas vigentes para A y B, enviar las dos aceptaciones al mismo tiempo en paralelo', async () => {
    const driverA = 'drv_A_cp01';
    const driverB = 'drv_B_cp01';
    const clientId = getUniqueClientId();

    // 1. Con ofertas vigentes para A y B
    const request = await service.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);
    const sendResult = await service.sendOffersForRequest(request.id, clientId, {
      driverIds: [driverA, driverB],
      ttlSeconds: 60
    });

    const offerA = sendResult.offers.find((o) => o.driverId === driverA)!;
    const offerB = sendResult.offers.find((o) => o.driverId === driverB)!;
    expect(offerA).toBeDefined();
    expect(offerB).toBeDefined();

    // 2. Enviar las dos aceptaciones al mismo tiempo en paralelo
    const responses = await Promise.allSettled([
      service.respondToOffer(offerA.id, driverA, { action: 'ACCEPT' }),
      service.respondToOffer(offerB.id, driverB, { action: 'ACCEPT' })
    ]);

    // 3. Sólo uno queda asignado; las respuestas no muestran dos ganadores
    const fulfilled = responses.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = responses.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect(fulfilled[0].value.status).toBe('ACCEPTED');
    expect(fulfilled[0].value.requestStatus).toBe('ASSIGNED');
    const winningDriverId = fulfilled[0].value.assignedDriverId;
    expect([driverA, driverB]).toContain(winningDriverId);

    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect(['REQUEST_ALREADY_ASSIGNED', 'OFFER_EXPIRED']).toContain(
      (rejected[0].reason as ConflictError).code
    );

    // 4. La consulta final no muestra dos ganadores
    const finalRequest = await service.getRideRequestById(request.id, clientId);
    expect(finalRequest.status).toBe('ASSIGNED');
    expect(finalRequest.assignedDriverId).toBe(winningDriverId);
  });

  // ==========================================================================
  // CP-5.5-03: Aceptación duplicada simultánea
  // ==========================================================================
  it('CP-5.5-03: Enviar en paralelo dos copias de la aceptación de la misma oferta y conductor', async () => {
    const driverDup = 'drv_dup_cp03';
    const clientId = getUniqueClientId();

    // 1. Crear solicitud y oferta
    const request = await service.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);
    const sendResult = await service.sendOffersForRequest(request.id, clientId, {
      driverIds: [driverDup],
      ttlSeconds: 60
    });

    const offer = sendResult.offers[0];

    // 2. Enviar en paralelo dos copias de la aceptación de la misma oferta y conductor
    const responses = await Promise.allSettled([
      service.respondToOffer(offer.id, driverDup, { action: 'ACCEPT' }),
      service.respondToOffer(offer.id, driverDup, { action: 'ACCEPT' })
    ]);

    const fulfilled = responses.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = responses.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    // 3. Se confirma una sola asignación y no se generan viajes duplicados
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    expect(fulfilled[0].value.status).toBe('ACCEPTED');
    expect(fulfilled[0].value.assignedDriverId).toBe(driverDup);

    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect(['OFFER_ALREADY_RESPONDED', 'REQUEST_ALREADY_ASSIGNED']).toContain(
      (rejected[0].reason as ConflictError).code
    );

    const finalRequest = await service.getRideRequestById(request.id, clientId);
    expect(finalRequest.status).toBe('ASSIGNED');
    expect(finalRequest.assignedDriverId).toBe(driverDup);
  });

  // ==========================================================================
  // CP-5.5-04: Otro conductor acepta después
  // ==========================================================================
  it('CP-5.5-04: Asignar a A; después B intenta aceptar su oferta anterior para esa misma solicitud', async () => {
    const driverA = 'drv_A_cp04';
    const driverB = 'drv_B_cp04';
    const clientId = getUniqueClientId();

    const request = await service.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);
    const sendResult = await service.sendOffersForRequest(request.id, clientId, {
      driverIds: [driverA, driverB],
      ttlSeconds: 60
    });

    const offerA = sendResult.offers.find((o) => o.driverId === driverA)!;
    const offerB = sendResult.offers.find((o) => o.driverId === driverB)!;

    // 1. Asignar primero a A
    const acceptA = await service.respondToOffer(offerA.id, driverA, { action: 'ACCEPT' });
    expect(acceptA.status).toBe('ACCEPTED');
    expect(acceptA.assignedDriverId).toBe(driverA);

    // 2. Después B intenta aceptar su oferta anterior para esa misma solicitud
    await expect(
      service.respondToOffer(offerB.id, driverB, { action: 'ACCEPT' })
    ).rejects.toThrow(ConflictError);

    // 3. La asignación permanece en A y se rechaza la aceptación de B
    const finalRequest = await service.getRideRequestById(request.id, clientId);
    expect(finalRequest.status).toBe('ASSIGNED');
    expect(finalRequest.assignedDriverId).toBe(driverA);
  });

  // ==========================================================================
  // CP-5.5-12: No perder la asignación al reiniciar
  // ==========================================================================
  it('CP-5.5-12: Asignar un conductor, reiniciar M5 y hacer que otro acepte una oferta anterior de esa solicitud', async () => {
    const driverOriginal = 'drv_original_12';
    const driverTardio = 'drv_tardio_12';

    const sharedDbService = new DbService();
    const sharedRedisService = new RedisService();
    const sharedRabbitMq = new RabbitMqService();

    // Instancia 1 de M5 (antes del reinicio)
    const m5BeforeRestart = new RideRequestService(sharedDbService, sharedRedisService, sharedRabbitMq);

    const clientId = getUniqueClientId();
    const requestInitial = await m5BeforeRestart.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);

    const sendResult = await m5BeforeRestart.sendOffersForRequest(requestInitial.id, clientId, {
      driverIds: [driverOriginal, driverTardio],
      ttlSeconds: 60
    });

    const offerOriginal = sendResult.offers.find((o) => o.driverId === driverOriginal)!;
    const offerTardio = sendResult.offers.find((o) => o.driverId === driverTardio)!;

    // 1. Asignar al conductor original
    const responseOriginal = await m5BeforeRestart.respondToOffer(offerOriginal.id, driverOriginal, {
      action: 'ACCEPT'
    });
    expect(responseOriginal.status).toBe('ACCEPTED');
    expect(responseOriginal.assignedDriverId).toBe(driverOriginal);

    // 2. Simular reinicio de M5: se destruye la memoria del proceso y se inicia una nueva instancia
    // conectada a la base de datos persistente compartida (sharedDbService)
    const m5AfterRestart = new RideRequestService(sharedDbService, sharedRedisService, sharedRabbitMq);

    // 3. Hacer que el otro conductor (driverTardio) intente aceptar su oferta anterior en la nueva instancia
    await expect(
      m5AfterRestart.respondToOffer(offerTardio.id, driverTardio, { action: 'ACCEPT' })
    ).rejects.toThrow(ConflictError);

    // 4. Se conserva el conductor original en la DB y no se permite una segunda asignación
    const finalDbRequest = await sharedDbService.getRideRequestById(requestInitial.id);
    expect(finalDbRequest).not.toBeNull();
    expect(finalDbRequest!.status).toBe('ASSIGNED');
    expect(finalDbRequest!.assignedDriverId).toBe(driverOriginal);

    // La oferta tardía permanece en estado EXPIRED en la persistencia compartida
    const offerTardioDb = await sharedDbService.getRideOfferById(offerTardio.id);
    expect(offerTardioDb!.status).toBe('EXPIRED');
  });

  // ==========================================================================
  // Casos Complementarios: Multi-Instancia y Resiliencia ante Fallas de Redis
  // ==========================================================================
  describe('Pruebas Complementarias: Multi-Instancia y Fallas de Redis', () => {
    it('Multi-Instancia: Dos instancias en paralelo compitiendo por la misma solicitud (solo una gana)', async () => {
      const sharedDb = new DbService();
      const sharedRedis = new RedisService();
      const sharedRabbit = new RabbitMqService();

      const nodeA = new RideRequestService(sharedDb, sharedRedis, sharedRabbit);
      const nodeB = new RideRequestService(sharedDb, sharedRedis, sharedRabbit);

      const clientId = getUniqueClientId();
      const req = await nodeA.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);

      const sendRes = await nodeA.sendOffersForRequest(req.id, clientId, {
        driverIds: ['drv_nodeA', 'drv_nodeB'],
        ttlSeconds: 60
      });

      const offerA = sendRes.offers.find((o) => o.driverId === 'drv_nodeA')!;
      const offerB = sendRes.offers.find((o) => o.driverId === 'drv_nodeB')!;

      const responses = await Promise.allSettled([
        nodeA.respondToOffer(offerA.id, 'drv_nodeA', { action: 'ACCEPT' }),
        nodeB.respondToOffer(offerB.id, 'drv_nodeB', { action: 'ACCEPT' })
      ]);

      const fulfilled = responses.filter((r) => r.status === 'fulfilled');
      const rejected = responses.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
    });

    it('Fallas de Redis: Asignación atómica garantizada ante error o caída total de Redis', async () => {
      const sharedDb = new DbService();
      const sharedRedis = new RedisService();
      const sharedRabbit = new RabbitMqService();

      const resilientService = new RideRequestService(sharedDb, sharedRedis, sharedRabbit);
      const clientId = getUniqueClientId();
      const req = await resilientService.createRideRequest(clientId, getUniqueKey(), sampleCreateDTO);

      const sendRes = await resilientService.sendOffersForRequest(req.id, clientId, {
        driverIds: ['drv_falla_1', 'drv_falla_2', 'drv_falla_3'],
        ttlSeconds: 60
      });

      // Simular desconexión crítica o fallo de socket en Redis
      jest.spyOn(sharedRedis, 'acquireAssignmentLock').mockRejectedValue(
        new Error('ECONNREFUSED: Redis cluster unreachable')
      );

      const responses = await Promise.allSettled(
        sendRes.offers.map((offer) =>
          resilientService.respondToOffer(offer.id, offer.driverId, { action: 'ACCEPT' })
        )
      );

      const fulfilled = responses.filter((r) => r.status === 'fulfilled');
      const rejected = responses.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);

      const finalReq = await sharedDb.getRideRequestById(req.id);
      expect(finalReq!.status).toBe('ASSIGNED');
    });
  });
});
