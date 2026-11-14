import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { M4ClientService, M4IntegrationError } from '../../src/services/m4-client.service';
import { RideRequestService, NotFoundError } from '../../src/services/ride-request.service';
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
    const now = Date.now();

    const mockResponse: M4NearbyDriversResponse = {
      vehicleType: 'AUTO',
      searchRadiusKm: 5,
      candidatesCount: 1,
      searchTimestamp: new Date(now).toISOString(),
      count: 1,
      drivers: [
        {
          driverId: 13,
          latitude: -34.604,
          longitude: -58.382,
          vehicleType: 'AUTO',
          available: true,
          updatedAt: new Date(now - 10000).toISOString(),
          expiresAt: new Date(now + 60000).toISOString(),
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

  it('debe lanzar M4IntegrationError con código M4_CONNECTION_FAILED si M4 no responde y no hay mocks sembrados (sin fallback silencioso)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED - Connection refused'))) as any;

    // Corrección RF-5.2 / RNF-05: Un fallo de M4 NO debe presentar conductores falsos como reales
    await expect(
      m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0)
    ).rejects.toThrow(M4IntegrationError);

    try {
      await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
    } catch (err: any) {
      expect(err).toBeInstanceOf(M4IntegrationError);
      expect(err.code).toBe('M4_CONNECTION_FAILED');
      expect(err.statusCode).toBe(503);
    }
  });

  it('debe lanzar M4IntegrationError con código M4_GATEWAY_TIMEOUT si M4 demora más del timeout configurado (3s)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn(() => Promise.reject(abortErr)) as any;

    try {
      await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
      throw new Error('No debió resolverse');
    } catch (err: any) {
      expect(err).toBeInstanceOf(M4IntegrationError);
      expect(err.code).toBe('M4_GATEWAY_TIMEOUT');
      expect(err.statusCode).toBe(504);
    }
  });

  it('debe usar mocks sembrados como simulación declarada y aprobada por cátedra (AE2 p.11)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED - Connection refused'))) as any;

    // Mocks aprobados (sembrados explícitamente para tests) sí están permitidos
    m4Client.seedMockDrivers([
      {
        driverId: 'drv-aprobado',
        latitude: -34.604,
        longitude: -58.382,
        vehicleType: 'AUTO',
        available: true,
        distanceKm: 1.0
      }
    ]);

    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
    expect(candidates.length).toBe(1);
    expect(candidates[0].driverId).toBe('drv-aprobado');
    expect(candidates[0].vehicleType).toBe('AUTO');
  });

  it('debe lanzar M4IntegrationError con código M4_SERVICE_UNAVAILABLE si M4 responde con HTTP error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({})
      } as any)
    ) as any;

    await expect(
      m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0)
    ).rejects.toThrow(M4IntegrationError);

    try {
      await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0);
    } catch (err: any) {
      expect(err.code).toBe('M4_SERVICE_UNAVAILABLE');
      expect(err.statusCode).toBe(502);
    }
  });

  it('debe ordenar por distancia antes de aplicar el límite al procesar respuesta de M4', async () => {
    // Corrección RF-5.2: El slice no debe descartar candidatos cercanos
    const mockResponse = {
      vehicleType: 'AUTO',
      searchRadiusKm: 5,
      candidatesCount: 4,
      searchTimestamp: new Date().toISOString(),
      count: 4,
      drivers: [
        { driverId: 'lejos-1', latitude: -34.65, longitude: -58.42, vehicleType: 'AUTO', available: true, distanceKm: 4.0 },
        { driverId: 'cerca-1', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 0.5 },
        { driverId: 'lejos-2', latitude: -34.66, longitude: -58.43, vehicleType: 'AUTO', available: true, distanceKm: 3.5 },
        { driverId: 'cerca-2', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.0 }
      ]
    };

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as any)
    ) as any;

    // Pido solo 2 candidatos: deben ser los 2 más cercanos, no los 2 primeros del array
    const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0, 2);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].driverId).toBe('cerca-1');  // 0.5 km
    expect(candidates[1].driverId).toBe('cerca-2');  // 1.0 km
  });

  // =========================================================================================
  // CASOS EXIGIDOS POR CONSIGNA Y MATRIZ DE CÁTEDRA (AE2 pp.11-12; RNF-17):
  // CP-5.2-01: Auto disponible, Auto ocupado y Moto disponible -> Solo Auto disponible
  // CP-5.2-04: Límite 2 con distancias 3 km, 2 km y 1 km -> Seleccionar 1 km y 2 km
  // CP-5.2-05: M4 lista vacía -> Informar que no hay candidatos sin inventar
  // CP-5.2-06: Acordar ubicación vieja -> Solo considerar candidato con ubicación vigente
  // =========================================================================================
  describe('Matriz de casos de prueba RF-5.2 (AE2 pp.11-12 / RNF-17)', () => {
    it('CP-5.2-01: Pedir Auto. M4 devuelve Auto disponible, Auto ocupado y Moto disponible -> Solo Auto disponible', async () => {
      const mockResponse: M4NearbyDriversResponse = {
        vehicleType: 'AUTO',
        searchRadiusKm: 5,
        candidatesCount: 3,
        searchTimestamp: new Date().toISOString(),
        count: 3,
        drivers: [
          { driverId: 'auto-disp', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 1.0 },
          { driverId: 'auto-ocup', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: false, distanceKm: 0.8 },
          { driverId: 'moto-disp', latitude: -34.606, longitude: -58.384, vehicleType: 'MOTO', available: true, distanceKm: 0.5 }
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
      expect(candidates[0].driverId).toBe('auto-disp');
      expect(candidates[0].vehicleType).toBe('AUTO');
    });

    it('CP-5.2-04: Con límite 2 y tres candidatos válidos a 3 km, 2 km y 1 km en ese orden -> Selecciona 1 km y 2 km', async () => {
      const mockResponse: M4NearbyDriversResponse = {
        vehicleType: 'AUTO',
        searchRadiusKm: 5,
        candidatesCount: 3,
        searchTimestamp: new Date().toISOString(),
        count: 3,
        drivers: [
          { driverId: 'cand-3km', latitude: -34.63, longitude: -58.41, vehicleType: 'AUTO', available: true, distanceKm: 3.0 },
          { driverId: 'cand-2km', latitude: -34.62, longitude: -58.40, vehicleType: 'AUTO', available: true, distanceKm: 2.0 },
          { driverId: 'cand-1km', latitude: -34.61, longitude: -58.39, vehicleType: 'AUTO', available: true, distanceKm: 1.0 }
        ]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockResponse
        } as any)
      ) as any;

      // Pide maxCandidates = 2 con radio 5 km
      const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 5.0, 2);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].driverId).toBe('cand-1km');
      expect(candidates[0].distanceKm).toBe(1.0);
      expect(candidates[1].driverId).toBe('cand-2km');
      expect(candidates[1].distanceKm).toBe(2.0);
    });

    it('CP-5.2-05: Hacer que M4 devuelva lista vacía para solicitud válida -> Informa sin candidatos, no inventa', async () => {
      const mockEmptyResponse: M4NearbyDriversResponse = {
        vehicleType: 'AUTO',
        searchRadiusKm: 5,
        candidatesCount: 0,
        searchTimestamp: new Date().toISOString(),
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

      m4Client.seedMockDrivers([
        { driverId: 'temp', latitude: originLat, longitude: originLng, vehicleType: 'AUTO', available: true, distanceKm: 1 }
      ]);
      const req = await rideRequestService.createRideRequest('client_vacio', 'idem_vacio', validDTO);
      m4Client.clearMockDrivers();

      await expect(
        rideRequestService.searchCandidatesForRequest(req.id, 'client_vacio', { radiusKm: 5.0 })
      ).rejects.toThrow(NotFoundError);

      const updated = await rideRequestService.getRideRequestById(req.id, 'client_vacio');
      expect(updated.status).toBe('NO_DRIVERS_AVAILABLE');
    });

    it('CP-5.2-06: Acordar con M4 cuándo una ubicación es vieja; devolver uno vigente y otro con ubicación vencida -> Solo considera vigente', async () => {
      const now = Date.now();
      const mockResponse: M4NearbyDriversResponse = {
        vehicleType: 'AUTO',
        searchRadiusKm: 5,
        candidatesCount: 2,
        searchTimestamp: new Date(now).toISOString(),
        count: 2,
        drivers: [
          {
            driverId: 'conductor-vigente',
            latitude: -34.604,
            longitude: -58.382,
            vehicleType: 'AUTO',
            available: true,
            distanceKm: 1.0,
            updatedAt: new Date(now - 10000).toISOString(), // Actualizado hace 10 seg
            expiresAt: new Date(now + 60000).toISOString()  // Expira en 60 seg
          },
          {
            driverId: 'conductor-ubicacion-vieja',
            latitude: -34.605,
            longitude: -58.383,
            vehicleType: 'AUTO',
            available: true,
            distanceKm: 0.8,
            updatedAt: new Date(now - 600000).toISOString(), // Actualizado hace 10 minutos
            expiresAt: new Date(now - 30000).toISOString()   // Expiró hace 30 seg
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
      expect(candidates[0].driverId).toBe('conductor-vigente');
    });

    it('Caso complementario: debe descartar conductores fuera del radio elegido (radioKm configurable)', async () => {
      const mockResponse: M4NearbyDriversResponse = {
        vehicleType: 'AUTO',
        searchRadiusKm: 3,
        candidatesCount: 2,
        searchTimestamp: new Date().toISOString(),
        count: 2,
        drivers: [
          { driverId: 'dentro-radio', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 2.5 },
          { driverId: 'fuera-radio', latitude: -34.650, longitude: -58.450, vehicleType: 'AUTO', available: true, distanceKm: 6.2 }
        ]
      };

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockResponse
        } as any)
      ) as any;

      const candidates = await m4Client.findNearbyDrivers(originLat, originLng, 'AUTO', 3.0);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].driverId).toBe('dentro-radio');
      expect(candidates[0].distanceKm).toBeLessThanOrEqual(3.0);
    });

    it('Caso complementario: caída o demora de M4 NO debe confundirse con NO_DRIVERS_AVAILABLE (lanza M4IntegrationError)', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as any;

      m4Client.seedMockDrivers([
        { driverId: 'temp', latitude: originLat, longitude: originLng, vehicleType: 'AUTO', available: true, distanceKm: 1 }
      ]);
      const req = await rideRequestService.createRideRequest('client_fallo', 'idem_fallo', validDTO);
      m4Client.clearMockDrivers();

      await expect(
        rideRequestService.searchCandidatesForRequest(req.id, 'client_fallo', { radiusKm: 5.0 })
      ).rejects.toThrow(M4IntegrationError);

      const updated = await rideRequestService.getRideRequestById(req.id, 'client_fallo');
      expect(updated.status).not.toBe('NO_DRIVERS_AVAILABLE');
    });
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
