import { beforeEach, describe, expect, it } from 'vitest';
import type { DriverLocation } from '../../src/domain/entities/location.entity.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';

const buildLocation = (overrides: Partial<DriverLocation> = {}): DriverLocation => {
  const now = Date.now();
  return {
    driverId: 101,
    latitude: -27.4692,
    longitude: -58.8306,
    vehicleType: 'AUTO',
    available: true,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides
  };
};

describe('MemoryLocationRepository (RF-4.1 / RF-4.3)', () => {
  let repository: MemoryLocationRepository;

  beforeEach(() => {
    repository = new MemoryLocationRepository();
  });

  it('debe guardar y devolver la ubicacion activa de un conductor', async () => {
    const location = buildLocation();

    const result = await repository.saveIfNewer(location, 60);

    expect(result.saved).toBe(true);
    expect(await repository.get(101)).toEqual(location);
  });

  it('no debe reemplazar una ubicacion por otra con marca temporal anterior', async () => {
    const recent = buildLocation({ updatedAt: '2026-11-17T12:00:10.000Z' });
    const older = buildLocation({ updatedAt: '2026-11-17T12:00:00.000Z', latitude: -27.5 });

    await repository.saveIfNewer(recent, 60);
    const result = await repository.saveIfNewer(older, 60);

    expect(result.saved).toBe(false);
    expect(result.location.latitude).toBe(-27.4692);
  });

  it('debe descartar las ubicaciones vencidas por TTL en get y getAll', async () => {
    const expired = buildLocation({ driverId: 102, expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await repository.saveIfNewer(buildLocation(), 60);
    await repository.saveIfNewer(expired, 60);

    expect(await repository.get(102)).toBeNull();
    const active = await repository.getAll();
    expect(active.map((location) => location.driverId)).toEqual([101]);
  });

  it('debe eliminar una ubicacion e informar si existia', async () => {
    await repository.saveIfNewer(buildLocation(), 60);

    expect(await repository.delete(101)).toBe(true);
    expect(await repository.delete(101)).toBe(false);
    expect(await repository.get(101)).toBeNull();
  });
});
