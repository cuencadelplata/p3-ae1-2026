import { beforeEach, describe, expect, it } from 'vitest';
import { SearchNearbyDriversUseCase } from '../src/application/use-cases/search-nearby-drivers.usecase.js';
import { UpdateLocationUseCase } from '../src/application/use-cases/update-location.usecase.js';
import { LocationValidationError, StaleLocationError } from '../src/domain/errors/location.errors.js';
import { MemoryLocationRepository } from '../src/infrastructure/redis/memory-location.repository.js';

describe('Location UseCases (M4)', () => {
  let repository: MemoryLocationRepository;
  let updateUseCase: UpdateLocationUseCase;
  let searchUseCase: SearchNearbyDriversUseCase;

  beforeEach(async () => {
    repository = new MemoryLocationRepository();
    updateUseCase = new UpdateLocationUseCase(repository, undefined, 60);
    searchUseCase = new SearchNearbyDriversUseCase(repository);
  });

  it('debe actualizar y recuperar la ubicación activa del conductor', async () => {
    const location = await updateUseCase.execute({
      driverId: 77,
      coordinates: { latitude: -27.4692, longitude: -58.8306 },
      vehicleType: 'AUTO',
      available: true
    });

    expect(location.driverId).toBe(77);
    expect(location.latitude).toBe(-27.4692);
    expect(location.longitude).toBe(-58.8306);
    expect(location.available).toBe(true);

    const stored = await repository.get(77);
    expect(stored?.driverId).toBe(77);
  });

  it('debe rechazar actualizaciones con marcas temporales futuras', async () => {
    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();

    await expect(
      updateUseCase.execute({
        driverId: 77,
        coordinates: { latitude: -27.4692, longitude: -58.8306 },
        vehicleType: 'AUTO',
        available: true,
        timestamp: futureTimestamp
      })
    ).rejects.toThrow(LocationValidationError);
  });

  it('debe rechazar marcas temporales obsoletas (StaleLocationError)', async () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    const stale = new Date(Date.now() - 10_000).toISOString();

    await updateUseCase.execute({
      driverId: 77,
      coordinates: { latitude: -27.4692, longitude: -58.8306 },
      vehicleType: 'AUTO',
      available: true,
      timestamp: recent
    });

    await expect(
      updateUseCase.execute({
        driverId: 77,
        coordinates: { latitude: -27.5, longitude: -58.9 },
        vehicleType: 'AUTO',
        available: true,
        timestamp: stale
      })
    ).rejects.toThrow(StaleLocationError);
  });
});
