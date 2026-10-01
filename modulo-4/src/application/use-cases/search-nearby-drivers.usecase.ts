import type { Coordinates, NearbyDriver, VehicleType } from '../../domain/entities/location.entity.js';
import { DistanceCalculator } from '../../domain/services/distance.calculator.js';
import type { LocationRepository } from '../../ports/location-repository.port.js';
import { Logger } from '../../infrastructure/logger/structured.logger.js';

export interface SearchNearbyInput {
  origin: Coordinates;
  vehicleType: VehicleType;
  radiusKm: number;
  limit: number;
}

export class SearchNearbyDriversUseCase {
  public constructor(private readonly locationRepository: LocationRepository) {}

  public async execute(input: SearchNearbyInput): Promise<NearbyDriver[]> {
    const { origin, vehicleType, radiusKm, limit } = input;
    DistanceCalculator.validateCoordinates(origin);

    const allLocations = await this.locationRepository.getAll();

    const candidates = allLocations
      .filter((loc) => loc.available && loc.vehicleType === vehicleType)
      .map((loc) => {
        const estimate = DistanceCalculator.estimate(origin, {
          latitude: loc.latitude,
          longitude: loc.longitude
        });
        return {
          ...loc,
          ...estimate
        };
      })
      .filter((driver) => driver.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    Logger.info(`Búsqueda de conductores cercanos completada`, {
      origin,
      vehicleType,
      radiusKm,
      limit,
      foundCount: candidates.length
    });

    return candidates;
  }
}
