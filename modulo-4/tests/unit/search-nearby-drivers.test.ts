import { beforeEach, describe, expect, it } from 'vitest';
import { SearchNearbyDriversUseCase } from '../../src/application/use-cases/search-nearby-drivers.usecase.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';
import type { DriverLocation } from '../../src/domain/entities/location.entity.js';

describe('SearchNearbyDriversUseCase (RF-4.2)', () => {
  let repository: MemoryLocationRepository;
  let useCase: SearchNearbyDriversUseCase;

  beforeEach(async () => {
    repository = new MemoryLocationRepository();
    useCase = new SearchNearbyDriversUseCase(repository);

    const now = Date.now();
    const futureExpiry = new Date(now + 60_000).toISOString();

    const drivers: DriverLocation[] = [
      {
        driverId: 'driver-1',
        latitude: -27.4695,
        longitude: -58.831,
        vehicleType: 'AUTO',
        available: true,
        updatedAt: new Date().toISOString(),
        expiresAt: futureExpiry
      },
      {
        driverId: 'driver-2', // Conductor lejano (> 10 km)
        latitude: -27.6000,
        longitude: -58.9000,
        vehicleType: 'AUTO',
        available: true,
        updatedAt: new Date().toISOString(),
        expiresAt: futureExpiry
      },
      {
        driverId: 'driver-3', // MOTO (debe ser filtrado cuando se busca AUTO)
        latitude: -27.4690,
        longitude: -58.8300,
        vehicleType: 'MOTO',
        available: true,
        updatedAt: new Date().toISOString(),
        expiresAt: futureExpiry
      },
      {
        driverId: 'driver-4', // No disponible (debe ser filtrado)
        latitude: -27.4691,
        longitude: -58.8305,
        vehicleType: 'AUTO',
        available: false,
        updatedAt: new Date().toISOString(),
        expiresAt: futureExpiry
      }
    ];

    for (const d of drivers) {
      await repository.saveIfNewer(d, 60);
    }
  });

  it('debe filtrar conductores por disponibilidad, tipo de vehículo y radio máximo', async () => {
    const origin = { latitude: -27.4692, longitude: -58.8306 };
    const results = await useCase.execute({
      origin,
      vehicleType: 'AUTO',
      radiusKm: 5,
      limit: 10
    });

    expect(results).toHaveLength(1);
    expect(results[0].driverId).toBe('driver-1');
  });

  it('debe ordenar los conductores por cercanía (menor a mayor distancia)', async () => {
    const now = Date.now();
    const futureExpiry = new Date(now + 60_000).toISOString();

    // Conductor 5 a 1 km
    await repository.saveIfNewer({
      driverId: 'driver-5',
      latitude: -27.4780,
      longitude: -58.8310,
      vehicleType: 'AUTO',
      available: true,
      updatedAt: new Date().toISOString(),
      expiresAt: futureExpiry
    }, 60);

    const origin = { latitude: -27.4692, longitude: -58.8306 };
    const results = await useCase.execute({
      origin,
      vehicleType: 'AUTO',
      radiusKm: 5,
      limit: 10
    });

    expect(results.length).toBe(2);
    expect(results[0].driverId).toBe('driver-1'); // Más cercano
    expect(results[1].driverId).toBe('driver-5'); // Segundo más cercano
    expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm);
  });
});
