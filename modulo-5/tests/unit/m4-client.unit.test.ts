import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { M4ClientService } from '../../src/services/m4-client.service';
import { RideRequestService } from '../../src/services/ride-request.service';
import { CreateRideRequestDTO, M4NearbyDriversResponse } from '../../src/types/ride-request.types';

describe('Integración HTTP con Módulo 4 (RF-4.2 / RF-5.2)', () => {
  let m4Client: M4ClientService;
  let rideRequestService: RideRequestService;
  const originalFetch = global.fetch;

  // Ubicación de prueba: Obelisco (-34.6037, -58.3816)
  const originLat = -34.6037;
  const originLng = -58.3816;

  const validDTO: CreateRideRequestDTO = {
    origin: { latitude: originLat, longitude: originLng, address: 'Av. 9 de Julio y Corrientes' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' },
    vehicleType: 'AUTO'
  };

  beforeEach(() => {
    delete process.env.M4_MOCK;
    m4Client = new M4ClientService('http://localhost:3004/api/v1');
    rideRequestService = new RideRequestService(undefined, undefined, m4Client);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    m4Client.clearMockDrivers();
  });

  it('debe consumir el endpoint GET /api/v1/drivers/nearby con los query params exactos del contrato de M4', async () => {
    let capturedUrl = '';

    const mockResponse: M4NearbyDriversResponse = {
      vehicleType: 'AUTO',
      searchRadiusKm: 5,
      candidatesCount: 1,
      searchTimestamp: '2026-10-05T20:00:00.000Z',
      count: 1,
      drivers: [
        {
          driverId: 13,
          latitude: -34.604,
          longitude: -58.382,
          vehicleType: 'AUTO',
          available: true,
          updatedAt: '2026-10-05T19:59:30.000Z',
          expiresAt: '2026-10-05T20:00:30.000Z',
          distanceKm: 0.8,
          estimatedEtaMinutes: 2
        }
      ]
    };

    global.fetch = jest.fn((url: any) => {
      capturedUrl = String(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any);
    }) as any;

    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0, 10);

    expect(capturedUrl).toContain('/api/v1/drivers/nearby');
    expect(capturedUrl).toContain('latitude=-34.6037');
    expect(capturedUrl).toContain('longitude=-58.3816');
    expect(capturedUrl).toContain('vehicleType=AUTO');
    expect(capturedUrl).toContain('radiusKm=5');
    expect(capturedUrl).toContain('maxCandidates=10');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].driverId).toBe('13'); // Convertido a string canónico
    expect(candidates[0].distanceKm).toBe(0.8);
    expect(candidates[0].vehicleType).toBe('AUTO');
  });

  it('debe devolver array vacío si M4 responde 200 con drivers: []', async () => {
    const mockEmptyResponse: M4NearbyDriversResponse = {
      vehicleType: 'AUTO',
      searchRadiusKm: 5,
      candidatesCount: 0,
      searchTimestamp: '2026-10-05T20:00:00.000Z',
      count: 0,
      drivers: []
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockEmptyResponse
      } as any)
    ) as any;

    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
    expect(candidates).toEqual([]);
  });

  it('debe filtrar conductores cuya disponibilidad sea false o difiera el tipo de vehículo', async () => {
    const mockResponse: M4NearbyDriversResponse = {
      vehicleType: 'AUTO',
      searchRadiusKm: 5,
      candidatesCount: 3,
      searchTimestamp: new Date().toISOString(),
      count: 3,
      drivers: [
        {
          driverId: 101,
          latitude: -34.604,
          longitude: -58.382,
          vehicleType: 'AUTO',
          available: true,
          distanceKm: 0.5
        },
        {
          driverId: 102,
          latitude: -34.605,
          longitude: -58.383,
          vehicleType: 'AUTO',
          available: false, // No disponible
          distanceKm: 0.7
        },
        {
          driverId: 103,
          latitude: -34.606,
          longitude: -58.384,
          vehicleType: 'MOTO', // Tipo vehículo no coincide
          available: true,
          distanceKm: 0.9
        }
      ]
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any)
    ) as any;

    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].driverId).toBe('101');
  });

  it('debe activar fallback sin romper la ejecución si M4 no responde o falla la red', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED - Connection refused'))) as any;

    // Con M4 apagado, cae elegantemente en candidatos de respaldo
    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toHaveProperty('driverId');
    expect(candidates[0].vehicleType).toBe('AUTO');
  });

  it('debe permitir sembrar conductores en memoria mediante seedMockDrivers para pruebas determinísticas', async () => {
    process.env.M4_MOCK = 'true';

    m4Client.seedMockDrivers([
      {
        driverId: 'drv-cercano',
        latitude: -34.604,
        longitude: -58.382,
        vehicleType: 'AUTO',
        available: true,
        distanceKm: 0.3
      },
      {
        driverId: 'drv-lejos',
        latitude: -34.7,
        longitude: -58.5,
        vehicleType: 'AUTO',
        available: true,
        distanceKm: 15.0
      }
    ]);

    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 3.0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].driverId).toBe('drv-cercano');
  });

  it('debe integrarse con el flujo completo de búsqueda en RideRequestService', async () => {
    process.env.M4_MOCK = 'true';

    m4Client.seedMockDrivers([
      {
        driverId: 13,
        latitude: -34.604,
        longitude: -58.382,
        vehicleType: 'AUTO',
        available: true,
        distanceKm: 0.8,
        estimatedEtaMinutes: 2
      }
    ]);

    const request = await rideRequestService.createRideRequest('client_test', 'idem_key_http', validDTO);
    const searchResponse = await rideRequestService.searchCandidatesForRequest(request.id, 'client_test', {
      radiusKm: 5.0,
      maxCandidates: 5
    });

    expect(searchResponse.candidatesCount).toBe(1);
    expect(searchResponse.candidates[0].driverId).toBe('13');
    expect(searchResponse.candidates[0].distanceKm).toBe(0.8);
  });
});
