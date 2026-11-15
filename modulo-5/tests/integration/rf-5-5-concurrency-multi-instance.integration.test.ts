import { RideRequestService, ConflictError } from '../../src/services/ride-request.service';
import { DbService } from '../../src/services/db.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMqService } from '../../src/services/rabbitmq.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';

/**
 * Suite de Pruebas de Integración para RF-5.5: Asignación Única y Resolución Atómica
 * 
 * Requerimientos verificados:
 * 1. Ante respuestas concurrentes, sólo un conductor puede quedar asignado al viaje.
 * 2. Asignación atómica mediante estado compartido y base de datos (DbService).
 * 3. Concurrencia entre múltiples instancias del servicio (Instancia A vs Instancia B).
 * 4. Tolerancia a fallos: Asignación atómica garantizada aún ante fallas o caída total de Redis.
 * 5. Invalidación/expiración inmediata de todas las ofertas competidoras tras la asignación.
 */
describe('RF-5.5: Asignación Única, Concurrencia Multi-Instancia y Fallas de Redis', () => {
  let dbService: DbService;
  let redisService: RedisService;
  let rabbitMqService: RabbitMqService;

  let instanceA: RideRequestService;
  let instanceB: RideRequestService;

  beforeEach(() => {
    dbService = new DbService();
    redisService = new RedisService();
    rabbitMqService = new RabbitMqService();

    // Simulamos dos instancias independientes de M5 compartiendo la misma infraestructura
    instanceA = new RideRequestService(dbService, redisService, rabbitMqService);
    instanceB = new RideRequestService(dbService, redisService, rabbitMqService);
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
      address: 'Obelisco, Buenos Aires'
    },
    destination: {
      latitude: -34.5885,
      longitude: -58.3974,
      address: 'Recoleta, Buenos Aires'
    },
    vehicleType: 'AUTO'
  };

  describe('Concurrencia entre Múltiples Instancias (Multi-Instance)', () => {
    it('debe permitir que solo un conductor gane cuando dos instancias procesan aceptaciones simultáneas', async () => {
      const clientId = `client_multi_${Date.now()}`;
      const idempotencyKey = `idemp_multi_${Date.now()}`;

      // 1. Crear solicitud a través de la Instancia A
      const request = await instanceA.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

      // 2. Despachar ofertas a 2 conductores competidores
      const sendResult = await instanceA.sendOffersForRequest(request.id, clientId, {
        driverIds: ['drv_inst_A', 'drv_inst_B'],
        ttlSeconds: 60
      });

      const offerA = sendResult.offers.find((o) => o.driverId === 'drv_inst_A')!;
      const offerB = sendResult.offers.find((o) => o.driverId === 'drv_inst_B')!;
      expect(offerA).toBeDefined();
      expect(offerB).toBeDefined();

      // 3. Ejecutar aceptación simultánea: conductor A responde en Instancia A, conductor B en Instancia B
      const responses = await Promise.allSettled([
        instanceA.respondToOffer(offerA.id, 'drv_inst_A', { action: 'ACCEPT' }),
        instanceB.respondToOffer(offerB.id, 'drv_inst_B', { action: 'ACCEPT' })
      ]);

      // 4. Exactamente una debe ganar (fulfilled) y exactamente una debe fallar con conflicto (rejected)
      const fulfilled = responses.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const rejected = responses.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // La respuesta exitosa confirma asignación
      expect(fulfilled[0].value.status).toBe('ACCEPTED');
      expect(fulfilled[0].value.requestStatus).toBe('ASSIGNED');
      const winningDriver = fulfilled[0].value.assignedDriverId;
      expect(['drv_inst_A', 'drv_inst_B']).toContain(winningDriver);

      // La respuesta perdedora es un ConflictError
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      expect(['REQUEST_ALREADY_ASSIGNED', 'OFFER_EXPIRED']).toContain(
        (rejected[0].reason as ConflictError).code
      );

      // 5. Verificar que el estado compartido en la base de datos es consistente
      const sharedRequest = await dbService.getRideRequestById(request.id);
      expect(sharedRequest).not.toBeNull();
      expect(sharedRequest!.status).toBe('ASSIGNED');
      expect(sharedRequest!.assignedDriverId).toBe(winningDriver);

      // 6. Verificar que la oferta perdedora quedó marcada como EXPIRED en la BD
      const losingOfferId = winningDriver === 'drv_inst_A' ? offerB.id : offerA.id;
      const losingOfferInDb = await dbService.getRideOfferById(losingOfferId);
      expect(losingOfferInDb).not.toBeNull();
      expect(losingOfferInDb!.status).toBe('EXPIRED');
    });
  });

  describe('Asignación Atómica ante Fallas de Redis', () => {
    it('debe mantener la asignación atómica y rechazar colisiones aunque Redis arroje un error fatal', async () => {
      const clientId = `client_redis_err_${Date.now()}`;
      const idempotencyKey = `idemp_redis_err_${Date.now()}`;

      // 1. Crear solicitud
      const request = await instanceA.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);

      // 2. Despachar ofertas a 3 conductores
      const driverIds = ['drv_fail_1', 'drv_fail_2', 'drv_fail_3'];
      const sendResult = await instanceA.sendOffersForRequest(request.id, clientId, {
        driverIds,
        ttlSeconds: 60
      });

      // 3. Simular falla crítica en Redis: acquireAssignmentLock rechaza con error de socket
      jest.spyOn(redisService, 'acquireAssignmentLock').mockRejectedValue(
        new Error('ECONNREFUSED: Redis cluster unreachable')
      );

      // 4. Los 3 conductores intentan aceptar concurrentemente mientras Redis está caído
      const responses = await Promise.allSettled(
        sendResult.offers.map((offer) =>
          instanceA.respondToOffer(offer.id, offer.driverId, { action: 'ACCEPT' })
        )
      );

      // 5. La DB compartida atómica debe garantizar que exactamente 1 gane y 2 sean rechazados
      const fulfilled = responses.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const rejected = responses.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);

      expect(fulfilled[0].value.status).toBe('ACCEPTED');
      expect(fulfilled[0].value.requestStatus).toBe('ASSIGNED');

      for (const rej of rejected) {
        expect(rej.reason).toBeInstanceOf(ConflictError);
        expect((rej.reason as ConflictError).code).toBe('REQUEST_ALREADY_ASSIGNED');
      }

      // 6. El estado en la BD debe ser asignado al único conductor ganador
      const finalRequest = await dbService.getRideRequestById(request.id);
      expect(finalRequest!.status).toBe('ASSIGNED');
      expect(driverIds).toContain(finalRequest!.assignedDriverId);
    });

    it('no debe permitir asignar una solicitud que ya se encontraba previamente cancelada por el cliente', async () => {
      const clientId = `client_cancel_${Date.now()}`;
      const idempotencyKey = `idemp_cancel_${Date.now()}`;

      const request = await instanceA.createRideRequest(clientId, idempotencyKey, sampleCreateDTO);
      const sendResult = await instanceA.sendOffersForRequest(request.id, clientId, {
        driverIds: ['drv_cancel_1'],
        ttlSeconds: 60
      });

      const offer = sendResult.offers[0];

      // Cliente cancela primero
      await instanceA.cancelRideRequest(request.id, clientId, { reason: 'Demora excesiva' });

      // Conductor intenta aceptar oferta de viaje cancelado
      await expect(
        instanceA.respondToOffer(offer.id, 'drv_cancel_1', { action: 'ACCEPT' })
      ).rejects.toThrow(ConflictError);

      const finalRequest = await dbService.getRideRequestById(request.id);
      expect(finalRequest!.status).toBe('CANCELLED');
    });
  });
});
