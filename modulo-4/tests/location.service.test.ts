import { describe, expect, it } from 'vitest';
import {
  LocationService,
  LocationValidationError,
  NotFoundError,
  StaleLocationError
} from '../src/services/location.service.js';
import { MemoryLocationRepository } from '../src/repositories/memory-location.repository.js';

const createService = (ttlSeconds = 60, now: () => number = Date.now) =>
  new LocationService(new MemoryLocationRepository(now), ttlSeconds, now);

describe('LocationService', () => {
  it('actualiza una ubicacion y la recupera mientras sigue vigente', async () => {
    const service = createService(60, () => 1_000);
    await service.updateLocation('driver-1', { latitude: -27.4692, longitude: -58.8306 }, 'AUTO', true);

    await expect(service.getActiveLocation('driver-1')).resolves.toMatchObject({
      driverId: 'driver-1',
      vehicleType: 'AUTO',
      available: true
    });
  });

  it('ordena conductores cercanos y filtra por tipo y disponibilidad', async () => {
    const service = createService(60, () => 1_000);
    await service.updateLocation('auto-cerca', { latitude: -27.4693, longitude: -58.8307 }, 'AUTO', true);
    await service.updateLocation('auto-lejos', { latitude: -27.48, longitude: -58.84 }, 'AUTO', true);
    await service.updateLocation('moto', { latitude: -27.4692, longitude: -58.8306 }, 'MOTO', true);
    await service.updateLocation('ocupado', { latitude: -27.4692, longitude: -58.8306 }, 'AUTO', false);

    const result = await service.findNearby(
      { latitude: -27.4692, longitude: -58.8306 },
      'AUTO',
      5,
      10
    );

    expect(result.map((driver) => driver.driverId)).toEqual(['auto-cerca', 'auto-lejos']);
  });

  it('descarta ubicaciones vencidas por TTL', async () => {
    let now = 1_000;
    const service = createService(10, () => now);
    await service.updateLocation('driver-1', { latitude: 0, longitude: 0 }, 'AUTO', true);
    now = 11_001;

    await expect(service.getActiveLocation('driver-1')).rejects.toThrow(NotFoundError);
  });

  it('rechaza una configuracion de TTL invalida', () => {
    expect(() => createService(0)).toThrow(LocationValidationError);
    expect(() => createService(Number.NaN)).toThrow(LocationValidationError);
  });

  it('rechaza marcas temporales demasiado adelantadas al reloj del servidor', async () => {
    const service = createService(60, () => 1_000);

    await expect(
      service.updateLocation(
        'driver-1',
        { latitude: -27.4692, longitude: -58.8306 },
        'AUTO',
        true,
        new Date(31_001).toISOString()
      )
    ).rejects.toThrow(LocationValidationError);
  });

  it('impide que una actualizacion atrasada sobrescriba una ubicacion mas reciente', async () => {
    const now = new Date('2026-09-10T12:00:30.000Z').getTime();
    const service = createService(60, () => now);

    await service.updateLocation(
      'driver-1',
      { latitude: -27.4692, longitude: -58.8306 },
      'AUTO',
      true,
      '2026-09-10T12:00:20.000Z'
    );

    await expect(
      service.updateLocation(
        'driver-1',
        { latitude: -27.5000, longitude: -58.9000 },
        'AUTO',
        true,
        '2026-09-10T12:00:10.000Z'
      )
    ).rejects.toThrow(StaleLocationError);

    expect((await service.getActiveLocation('driver-1')).latitude).toBe(-27.4692);
  });

  it('elimina una ubicacion activa', async () => {
    const service = createService(60, () => 1_000);
    await service.updateLocation('driver-1', { latitude: -27.4692, longitude: -58.8306 }, 'AUTO', true);

    await service.removeLocation('driver-1');

    await expect(service.getActiveLocation('driver-1')).rejects.toThrow(NotFoundError);
  });

  it('rechaza eliminar una ubicacion inexistente o vencida', async () => {
    const service = createService(60, () => 1_000);

    await expect(service.removeLocation('driver-x')).rejects.toThrow(NotFoundError);
  });

  it('calcula distancia y ETA', () => {
    const service = createService();
    const result = service.estimate(
      { latitude: -27.4692, longitude: -58.8306 },
      { latitude: -27.4875, longitude: -58.7896 }
    );

    expect(result.distanceKm).toBeGreaterThan(4);
    expect(result.estimatedEtaMinutes).toBeGreaterThan(0);
  });
});
