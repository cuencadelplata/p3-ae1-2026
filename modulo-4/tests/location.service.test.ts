import { describe, expect, it } from 'vitest';
import { LocationService, NotFoundError } from '../src/services/location.service.js';

describe('LocationService', () => {
  it('actualiza una ubicacion y la recupera mientras sigue vigente', () => {
    const service = new LocationService(60, () => 1_000);
    service.updateLocation('driver-1', { latitude: -27.4692, longitude: -58.8306 }, 'AUTO', true);

    expect(service.getActiveLocation('driver-1')).toMatchObject({
      driverId: 'driver-1',
      vehicleType: 'AUTO',
      available: true
    });
  });

  it('ordena conductores cercanos y filtra por tipo y disponibilidad', () => {
    const service = new LocationService(60, () => 1_000);
    service.updateLocation('auto-cerca', { latitude: -27.4693, longitude: -58.8307 }, 'AUTO', true);
    service.updateLocation('auto-lejos', { latitude: -27.48, longitude: -58.84 }, 'AUTO', true);
    service.updateLocation('moto', { latitude: -27.4692, longitude: -58.8306 }, 'MOTO', true);
    service.updateLocation('ocupado', { latitude: -27.4692, longitude: -58.8306 }, 'AUTO', false);

    const result = service.findNearby(
      { latitude: -27.4692, longitude: -58.8306 },
      'AUTO',
      5,
      10
    );

    expect(result.map((driver) => driver.driverId)).toEqual(['auto-cerca', 'auto-lejos']);
  });

  it('descarta ubicaciones vencidas por TTL', () => {
    let now = 1_000;
    const service = new LocationService(10, () => now);
    service.updateLocation('driver-1', { latitude: 0, longitude: 0 }, 'AUTO', true);
    now = 11_001;

    expect(() => service.getActiveLocation('driver-1')).toThrow(NotFoundError);
  });

  it('calcula distancia y ETA', () => {
    const service = new LocationService();
    const result = service.estimate(
      { latitude: -27.4692, longitude: -58.8306 },
      { latitude: -27.4875, longitude: -58.7896 }
    );

    expect(result.distanceKm).toBeGreaterThan(4);
    expect(result.estimatedEtaMinutes).toBeGreaterThan(0);
  });
});
