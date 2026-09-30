import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RedisService } from '../../src/services/redis.service';
import { RideRequestService } from '../../src/services/ride-request.service';
import { CreateRideRequestDTO, M4DriverLocation } from '../../src/types/ride-request.types';

describe('Integración Módulo 4 en Redis (RF-5.2)', () => {
  let redisService: RedisService;
  let rideRequestService: RideRequestService;

  // Centro de prueba: Obelisco (-34.6037, -58.3816)
  const originLat = -34.6037;
  const originLng = -58.3816;

  const validDTO: CreateRideRequestDTO = {
    origin: { latitude: originLat, longitude: originLng, address: 'Av. 9 de Julio y Corrientes' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' },
    vehicleType: 'AUTO'
  };

  beforeEach(() => {
    // Inicializar servicios con Redis deshabilitado para usar memoryFallback
    process.env.DISABLE_REDIS = 'true';
    redisService = new RedisService();
    rideRequestService = new RideRequestService(redisService);
  });

  afterEach(async () => {
    await redisService.clearM4Drivers();
  });

  it('debe guardar y consultar ubicaciones según el contrato de M4 (m4:driver:{driverId}:location)', async () => {
    const driverData: M4DriverLocation = {
      driverId: 'driver-corrientes',
      latitude: -34.6040, // Muy cerca del Obelisco (~50 metros)
      longitude: -58.3820,
      vehicleType: 'AUTO',
      available: true,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString()
    };

    await redisService.saveM4DriverLocation(driverData, 60);

    const candidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'AUTO', 5.0);

    expect(candidates.length).toBe(1);
    expect(candidates[0].driverId).toBe('driver-corrientes');
    expect(candidates[0].vehicleType).toBe('AUTO');
    expect(candidates[0].distanceKm).toBeLessThan(0.2); // Menos de 200 metros
  });

  it('debe filtrar conductores cuya disponibilidad sea available: false', async () => {
    // Conductor disponible
    await redisService.saveM4DriverLocation({
      driverId: 'driver-online',
      latitude: -34.6050,
      longitude: -58.3820,
      vehicleType: 'AUTO',
      available: true
    });

    // Conductor ocupado / offline
    await redisService.saveM4DriverLocation({
      driverId: 'driver-busy',
      latitude: -34.6040,
      longitude: -58.3820,
      vehicleType: 'AUTO',
      available: false
    });

    const candidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'AUTO', 5.0);

    expect(candidates.length).toBe(1);
    expect(candidates[0].driverId).toBe('driver-online');
  });

  it('debe filtrar conductores cuyo vehicleType no coincida con el solicitado', async () => {
    await redisService.saveM4DriverLocation({
      driverId: 'driver-auto',
      latitude: -34.6050,
      longitude: -58.3820,
      vehicleType: 'AUTO',
      available: true
    });

    await redisService.saveM4DriverLocation({
      driverId: 'driver-moto',
      latitude: -34.6040,
      longitude: -58.3820,
      vehicleType: 'MOTO',
      available: true
    });

    // Búsqueda para AUTO
    const autoCandidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'AUTO', 5.0);
    expect(autoCandidates.length).toBe(1);
    expect(autoCandidates[0].driverId).toBe('driver-auto');

    // Búsqueda para MOTO
    const motoCandidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'MOTO', 5.0);
    expect(motoCandidates.length).toBe(1);
    expect(motoCandidates[0].driverId).toBe('driver-moto');
  });

  it('debe filtrar conductores que excedan el radio de búsqueda (radiusKm)', async () => {
    // Conductor cercano (~1.5 km en Retiro)
    await redisService.saveM4DriverLocation({
      driverId: 'driver-retiro',
      latitude: -34.5925,
      longitude: -58.3755,
      vehicleType: 'AUTO',
      available: true
    });

    // Conductor lejano (~15 km en San Isidro)
    await redisService.saveM4DriverLocation({
      driverId: 'driver-lejos',
      latitude: -34.4716,
      longitude: -58.5287,
      vehicleType: 'AUTO',
      available: true
    });

    // Radio de 3 km: solo debe incluir al de Retiro
    const candidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'AUTO', 3.0);

    expect(candidates.length).toBe(1);
    expect(candidates[0].driverId).toBe('driver-retiro');
  });

  it('debe ordenar los conductores ascendentemente por distancia calculada con Haversine', async () => {
    // Conductor a ~2 km
    await redisService.saveM4DriverLocation({
      driverId: 'driver-medio',
      latitude: -34.6150,
      longitude: -58.3700,
      vehicleType: 'AUTO',
      available: true
    });

    // Conductor a ~300 metros
    await redisService.saveM4DriverLocation({
      driverId: 'driver-cercano',
      latitude: -34.6045,
      longitude: -58.3830,
      vehicleType: 'AUTO',
      available: true
    });

    // Conductor a ~4 km
    await redisService.saveM4DriverLocation({
      driverId: 'driver-mas-lejos',
      latitude: -34.5700,
      longitude: -58.4000,
      vehicleType: 'AUTO',
      available: true
    });

    const candidates = await redisService.findNearbyDriversFromM4(originLat, originLng, 'AUTO', 5.0);

    expect(candidates.length).toBe(3);
    expect(candidates[0].driverId).toBe('driver-cercano');
    expect(candidates[1].driverId).toBe('driver-medio');
    expect(candidates[2].driverId).toBe('driver-mas-lejos');
    expect(candidates[0].distanceKm).toBeLessThan(candidates[1].distanceKm);
    expect(candidates[1].distanceKm).toBeLessThan(candidates[2].distanceKm);
  });

  it('debe integrar exitosamente con searchCandidatesForRequest en RideRequestService', async () => {
    await redisService.saveM4DriverLocation({
      driverId: 'driver-real-1',
      latitude: -34.6045,
      longitude: -58.3830,
      vehicleType: 'AUTO',
      available: true
    });

    const request = await rideRequestService.createRideRequest('client_test', 'idem_key_m4', validDTO);
    const searchResponse = await rideRequestService.searchCandidatesForRequest(request.id, 'client_test', {
      radiusKm: 5.0,
      maxCandidates: 5
    });

    expect(searchResponse.candidatesCount).toBe(1);
    expect(searchResponse.candidates[0].driverId).toBe('driver-real-1');
    expect(searchResponse.candidates[0].estimatedEtaMinutes).toBeGreaterThanOrEqual(1);
  });
});
