import { RideRequestService, ConflictError, NotFoundError, ValidationError } from '../../src/services/ride-request.service';
import { RedisService } from '../../src/services/redis.service';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { RideRequestValidator } from '../../src/schemas/ride-request.schema';
import { authenticate } from '../../src/middleware/auth.middleware';
import { CreateRideRequestDTO } from '../../src/types/ride-request.types';
import { createHmac } from 'node:crypto';
import { Request, Response } from 'express';

/**
 * Suite oficial de Casos de Prueba (CP) de la consigna AE2 para RF-5.1
 * Cobertura de:
 * - CP-5.1-01: Solicitar un Auto con origen y destino válidos
 * - CP-5.1-02: Solicitar una Moto
 * - CP-5.1-03: Falta un dato obligatorio (sin destino)
 * - CP-5.1-04: Coordenadas inválidas (latitud 100)
 * - CP-5.1-06: Vehículo no permitido (Camión)
 * - CP-5.1-07: Solicitar sin autenticación ni credencial
 * - CP-5.1-09: No duplicar solicitudes: Variante S (secuencial) y Variante P (paralelo)
 * - CP-5.1-10: No mezclar solicitudes de clientes con la misma clave
 * - CP-5.1-14: Conservar la solicitud al reiniciar M5 y consultarla por ID
 */
describe('Casos de Prueba Consigna AE2 — RF-5.1 (Solicitud de Viaje)', () => {
  const JWT_SECRET = 'secreto-consigna-ae2';

  const generateToken = (userId: string, expOffset = 3600) => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + expOffset })
    ).toString('base64url');
    const signature = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${signature}`;
  };

  const validOrigin = {
    latitude: -34.6037,
    longitude: -58.3816,
    address: 'Av. 9 de Julio y Corrientes (Obelisco)'
  };

  const validDestination = {
    latitude: -34.5885,
    longitude: -58.3974,
    address: 'Av. Alvear 1891 (Recoleta)'
  };

  const validAutoDTO: CreateRideRequestDTO = {
    origin: validOrigin,
    destination: validDestination,
    vehicleType: 'AUTO'
  };

  let redis: RedisService;
  let rabbit: RabbitMQService;
  let service: RideRequestService;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_SECRET = JWT_SECRET;
    redis = new RedisService();
    rabbit = new RabbitMQService();
    service = new RideRequestService(redis, rabbit);
  });

  // ==========================================================================
  // CP-5.1-01: Solicitar un Auto
  // ==========================================================================
  it('CP-5.1-01: Iniciar sesión como cliente y pedir un viaje Auto con origen y destino válidos', async () => {
    const clientId = 'client_cp_01';
    const idempotencyKey = 'key_cp_01';

    const result = await service.createRideRequest(clientId, idempotencyKey, validAutoDTO);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.clientId).toBe(clientId);
    expect(result.vehicleType).toBe('AUTO');
    expect(result.origin.address).toBe(validOrigin.address);
    expect(result.origin.latitude).toBe(validOrigin.latitude);
    expect(result.destination.address).toBe(validDestination.address);
    expect(result.destination.latitude).toBe(validDestination.latitude);
    expect(result.status).toBe('SEARCHING');
  });

  // ==========================================================================
  // CP-5.1-02: Solicitar una Moto
  // ==========================================================================
  it('CP-5.1-02: Con un cliente sin solicitud activa, pedir un viaje Moto con origen y destino válidos', async () => {
    const clientId = 'client_cp_02';
    const idempotencyKey = 'key_cp_02';
    const motoDTO: CreateRideRequestDTO = {
      origin: validOrigin,
      destination: validDestination,
      vehicleType: 'MOTO'
    };

    const result = await service.createRideRequest(clientId, idempotencyKey, motoDTO);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.clientId).toBe(clientId);
    expect(result.vehicleType).toBe('MOTO');
    expect(result.status).toBe('SEARCHING');
    expect(result.estimatedFare.amount).toBeGreaterThan(0);
  });

  // ==========================================================================
  // CP-5.1-03: Falta un dato obligatorio (omitir destino)
  // ==========================================================================
  it('CP-5.1-03: Con sesión válida, enviar origen y tipo Auto, pero omitir el destino', async () => {
    const clientId = 'client_cp_03';
    const idempotencyKey = 'key_cp_03';
    const payloadSinDestino = {
      origin: validOrigin,
      vehicleType: 'AUTO'
    } as any;

    // Validación a nivel Schema Zod
    const validation = RideRequestValidator.validateCreateRequest(payloadSinDestino);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.toLowerCase().includes('destino') || err.toLowerCase().includes('destination'))).toBe(true);

    // Intento en el servicio debe rechazar con ValidationError sin crear la solicitud
    await expect(
      service.createRideRequest(clientId, idempotencyKey, payloadSinDestino)
    ).rejects.toThrow(ValidationError);
  });

  // ==========================================================================
  // CP-5.1-04: Coordenadas inválidas (latitud 100)
  // ==========================================================================
  it('CP-5.1-04: Enviar un origen con latitud 100 y un destino válido', async () => {
    const clientId = 'client_cp_04';
    const idempotencyKey = 'key_cp_04';
    const payloadLatitudInvalida: CreateRideRequestDTO = {
      origin: {
        latitude: 100, // Fuera del rango válido [-90, 90]
        longitude: -58.3816,
        address: 'Coordenada Fuera de Rango'
      },
      destination: validDestination,
      vehicleType: 'AUTO'
    };

    const validation = RideRequestValidator.validateCreateRequest(payloadLatitudInvalida);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('-90') && err.includes('90'))).toBe(true);

    await expect(
      service.createRideRequest(clientId, idempotencyKey, payloadLatitudInvalida)
    ).rejects.toThrow(ValidationError);
  });

  // ==========================================================================
  // CP-5.1-06: Vehículo no permitido (Camión)
  // ==========================================================================
  it('CP-5.1-06: Enviar origen y destino válidos y tipo de vehículo Camión', async () => {
    const clientId = 'client_cp_06';
    const idempotencyKey = 'key_cp_06';
    const payloadCamion = {
      origin: validOrigin,
      destination: validDestination,
      vehicleType: 'CAMION'
    } as any;

    const validation = RideRequestValidator.validateCreateRequest(payloadCamion);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((err) => err.includes('AUTO') || err.includes('MOTO'))).toBe(true);

    await expect(
      service.createRideRequest(clientId, idempotencyKey, payloadCamion)
    ).rejects.toThrow(ValidationError);
  });

  // ==========================================================================
  // CP-5.1-07: Solicitar sin autenticación
  // ==========================================================================
  it('CP-5.1-07: Enviar una solicitud válida sin iniciar sesión ni enviar una credencial', () => {
    // Simulamos la llamada HTTP interceptada por el middleware de autenticación (RNF-10)
    const mockReq = {
      headers: {}, // Sin Authorization header
      body: validAutoDTO
    } as unknown as Request;

    let statusCode: number | null = null;
    let jsonResponse: any = null;

    const mockRes = {
      setHeader: jest.fn(),
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      json: (data: any) => {
        jsonResponse = data;
        return mockRes;
      }
    } as unknown as Response;

    const nextFn = jest.fn();

    authenticate(mockReq, mockRes, nextFn);

    // Debe ser rechazado con 401 Unauthorized sin llegar a next() y sin asignar usuario demo
    expect(statusCode).toBe(401);
    expect(jsonResponse.code).toBe('UNAUTHENTICATED');
    expect(nextFn).not.toHaveBeenCalled();
    expect((mockReq as any).auth).toBeUndefined();
  });

  // ==========================================================================
  // CP-5.1-09: No duplicar solicitudes: seguido (S) y en paralelo (P)
  // ==========================================================================
  describe('CP-5.1-09: No duplicar solicitudes (S y P)', () => {
    it('CP-5.1-09 Variante S: enviarlo dos veces seguidas con la misma clave de reintento conserva el mismo ID', async () => {
      const clientId = 'client_cp_09_s';
      const sameKey = 'idem_key_cp_09_s';

      const firstCall = await service.createRideRequest(clientId, sameKey, validAutoDTO);
      const secondCall = await service.createRideRequest(clientId, sameKey, validAutoDTO);

      expect(firstCall.id).toBe(secondCall.id);
      expect(firstCall.createdAt).toBe(secondCall.createdAt);
      // No debe publicar eventos duplicados a RabbitMQ
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });

    it('CP-5.1-09 Variante P: lanzar dos copias a la vez en paralelo deja una sola solicitud y devuelve el mismo ID', async () => {
      const clientId = 'client_cp_09_p';
      const sameKey = 'idem_key_cp_09_p';

      // Lanzar 2 copias concurrentes simultáneas mediante Promise.all
      const [res1, res2] = await Promise.all([
        service.createRideRequest(clientId, sameKey, validAutoDTO),
        service.createRideRequest(clientId, sameKey, validAutoDTO)
      ]);

      // Ambas reciben el mismo ID sin generar un segundo registro
      expect(res1.id).toBe(res2.id);
      expect(rabbit.getPublishedEvents()).toHaveLength(1);
    });

    it('CP-5.1-09 Variante P (claves distintas concurrentes): solo una gana y la otra recibe conflicto 409', async () => {
      const clientId = 'client_cp_09_p2';
      const keyA = 'key_cp_09_a';
      const keyB = 'key_cp_09_b';

      const results = await Promise.allSettled([
        service.createRideRequest(clientId, keyA, validAutoDTO),
        service.createRideRequest(clientId, keyB, validAutoDTO)
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason).toBeInstanceOf(ConflictError);
      expect(rejectedReason.code).toBe('ACTIVE_REQUEST_EXISTS');
    });
  });

  // ==========================================================================
  // CP-5.1-10: No mezclar solicitudes de clientes con la misma clave
  // ==========================================================================
  it('CP-5.1-10: A crea una solicitud con una clave. B envía su propio pedido usando esa misma clave', async () => {
    const clientA = 'client_A';
    const clientB = 'client_B';
    const sharedKey = 'clave_compartida_123';

    const reqA = await service.createRideRequest(clientA, sharedKey, validAutoDTO);
    const reqB = await service.createRideRequest(clientB, sharedKey, validAutoDTO);

    // B NO recibe la solicitud ni los datos de A: son dos viajes distintos
    expect(reqB.id).toBeDefined();
    expect(reqA.id).toBeDefined();
    expect(reqB.id).not.toBe(reqA.id);
    expect(reqA.clientId).toBe(clientA);
    expect(reqB.clientId).toBe(clientB);

    // Si B intenta consultar la solicitud de A, se le deniega el acceso (403)
    await expect(service.getRideRequestById(reqA.id, clientB)).rejects.toMatchObject({
      name: 'ConflictError',
      code: 'FORBIDDEN_ACCESS'
    });
  });

  // ==========================================================================
  // CP-5.1-14: Conservar la solicitud al reiniciar M5
  // ==========================================================================
  it('CP-5.1-14: Crear una solicitud, anotar su ID, reiniciar M5 y consultarla nuevamente', async () => {
    const clientId = 'client_cp_14';
    const key = 'key_cp_14';

    // 1. Crear la solicitud y anotar su ID
    const created = await service.createRideRequest(clientId, key, validAutoDTO);
    const originalId = created.id;
    expect(originalId).toBeDefined();

    // 2. Simular reinicio de M5: nueva instancia de RideRequestService (memoria local vacía)
    // conectada al mismo backing service de persistencia (Redis)
    const m5Reiniciado = new RideRequestService(redis, rabbit);

    // 3. Consultar nuevamente por ID
    const recovered = await m5Reiniciado.getRideRequestById(originalId, clientId);

    // 4. Se recupera la misma solicitud intacta con todos sus datos
    expect(recovered).toBeDefined();
    expect(recovered.id).toBe(originalId);
    expect(recovered.clientId).toBe(clientId);
    expect(recovered.vehicleType).toBe('AUTO');
    expect(recovered.origin.address).toBe(validOrigin.address);
    expect(recovered.destination.address).toBe(validDestination.address);
    expect(recovered.status).toBe('SEARCHING');
  });
});
