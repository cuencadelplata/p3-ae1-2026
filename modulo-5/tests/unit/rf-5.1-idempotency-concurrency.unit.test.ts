import { RideRequestService, ConflictError, NotFoundError, ValidationError } from '../../src/services/ride-request.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';

/**
 * RF-5.1 — Idempotencia y concurrencia (AE2: RNF-08 / RNF-09)
 * Casos: datos inválidos, solicitud válida, duplicados concurrentes,
 * reutilización de clave entre clientes y recuperación tras reinicio.
 */
describe('RF-5.1 — idempotencia y concurrencia', () => {
  const validDTO: CreateRideRequestDTO = {
    origin: { latitude: -34.6037, longitude: -58.3816, address: 'Av. 9 de Julio y Corrientes (Obelisco)' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Av. Alvear 1891 (Recoleta)' },
    vehicleType: 'AUTO'
  };

  let redis: RedisService;
  let rabbit: RabbitMQService;
  let service: RideRequestService;

  beforeEach(() => {
    redis = new RedisService();
    rabbit = new RabbitMQService();
    service = new RideRequestService(redis, rabbit);
  });

  describe('casos base', () => {
    it('RF-5.1 rechaza datos inválidos con ValidationError y no deja al cliente bloqueado', async () => {
      const invalid = { origin: null, destination: null, vehicleType: 'INVALID' } as any;
      await expect(service.createRideRequest('client_a', 'key_1', invalid)).rejects.toThrow(ValidationError);

      // el cliente puede pedir un viaje válido enseguida
      const ok = await service.createRideRequest('client_a', 'key_2', validDTO);
      expect(ok.status).toBe('SEARCHING');
    });

    it('RF-5.1 crea una solicitud válida y publica un único evento ride.requested', async () => {
      const created = await service.createRideRequest('client_a', 'key_1', validDTO);
      expect(created.clientId).toBe('client_a');
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });
  });

  describe('duplicados concurrentes', () => {
    it('RF-5.1 misma clave y mismo cliente en simultáneo => una sola solicitud', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => service.createRideRequest('client_a', 'same_key', validDTO))
      );

      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });

    it('RF-5.1 claves distintas del mismo cliente en simultáneo => solo una gana, el resto 409', async () => {
      const settled = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => service.createRideRequest('client_a', `key_${i}`, validDTO))
      );

      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      rejected.forEach((r) => {
        expect(r.reason).toBeInstanceOf(ConflictError);
        expect(r.reason.code).toBe('ACTIVE_REQUEST_EXISTS');
      });
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });

    it('RF-5.1 clientes distintos en simultáneo no se bloquean entre sí', async () => {
      const results = await Promise.all(
        ['client_a', 'client_b', 'client_c'].map((c) => service.createRideRequest(c, `key_${c}`, validDTO))
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(3);
    });
  });

  describe('clave de idempotencia atada al cliente y al contenido', () => {
    it('RF-5.1 la misma Idempotency-Key en otro cliente NO devuelve la solicitud ajena', async () => {
      const a = await service.createRideRequest('client_a', 'shared_key', validDTO);
      const b = await service.createRideRequest('client_b', 'shared_key', validDTO);

      expect(b.id).not.toBe(a.id);
      expect(b.clientId).toBe('client_b');
      // y el cliente B tampoco puede leer la solicitud de A
      await expect(service.getRideRequestById(a.id, 'client_b')).rejects.toThrow(ConflictError);
    });

    it('RF-5.1 la misma clave con contenido distinto se rechaza (IDEMPOTENCY_KEY_REUSED)', async () => {
      await service.createRideRequest('client_a', 'key_1', validDTO);

      const otherDTO: CreateRideRequestDTO = { ...validDTO, vehicleType: 'MOTO' };
      await expect(service.createRideRequest('client_a', 'key_1', otherDTO)).rejects.toMatchObject({
        name: 'ConflictError',
        code: 'IDEMPOTENCY_KEY_REUSED'
      });
    });

    it('RF-5.1 misma clave con contenido distinto en simultáneo: una gana y la otra se rechaza', async () => {
      const otherDTO: CreateRideRequestDTO = { ...validDTO, vehicleType: 'MOTO' };
      const settled = await Promise.allSettled([
        service.createRideRequest('client_a', 'key_1', validDTO),
        service.createRideRequest('client_a', 'key_1', otherDTO)
      ]);

      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')!;
      expect(rejected.reason.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('RF-5.1 repetir la solicitud con la misma clave devuelve la original y no duplica eventos', async () => {
      const first = await service.createRideRequest('client_a', 'key_1', validDTO);
      const second = await service.createRideRequest('client_a', 'key_1', validDTO);

      expect(second.id).toBe(first.id);
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });
  });

  describe('recuperación', () => {
    it('RF-5.1 tras reiniciar el servicio (mismo Redis) la clave repetida devuelve la misma solicitud', async () => {
      const created = await service.createRideRequest('client_a', 'key_1', validDTO);

      // "Reinicio": proceso nuevo (sin memoria propia), mismo Redis compartido
      const restarted = new RideRequestService(redis, rabbit);
      const replay = await restarted.createRideRequest('client_a', 'key_1', validDTO);

      expect(replay.id).toBe(created.id);
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
      // la solicitud queda consultable en el proceso nuevo
      const fetched = await restarted.getRideRequestById(created.id, 'client_a');
      expect(fetched.id).toBe(created.id);
    });

    it('RF-5.1 tras reiniciar, una solicitud que nunca se reintentó no se recupera (límite documentado)', async () => {
      const created = await service.createRideRequest('client_a', 'key_1', validDTO);
      const restarted = new RideRequestService(redis, rabbit);

      await expect(restarted.getRideRequestById(created.id, 'client_a')).rejects.toThrow(NotFoundError);
    });

    it('RF-5.1 si la creación falla, libera el candado y permite reintentar', async () => {
      jest.spyOn(redis, 'cacheEstimatedFare').mockRejectedValueOnce(new Error('fallo simulado'));

      await expect(service.createRideRequest('client_a', 'key_1', validDTO)).rejects.toThrow('fallo simulado');

      // sin el candado liberado, este reintento devolvería 409 durante 3 minutos
      const retry = await service.createRideRequest('client_a', 'key_1', validDTO);
      expect(retry.status).toBe('SEARCHING');
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });
  });
});
