import type { Coordinates, DriverLocation, VehicleType } from '../../domain/entities/location.entity.js';
import { LocationValidationError, StaleLocationError } from '../../domain/errors/location.errors.js';
import { DistanceCalculator } from '../../domain/services/distance.calculator.js';
import type { LocationHistoryRepository, LocationRepository } from '../../ports/location-repository.port.js';

export interface UpdateLocationInput {
  driverId: number;
  coordinates: Coordinates;
  vehicleType: VehicleType;
  available: boolean;
  timestamp?: string;
}

export class UpdateLocationUseCase {
  public constructor(
    private readonly locationRepository: LocationRepository,
    private readonly historyRepository?: LocationHistoryRepository,
    private readonly ttlSeconds = 60,
    private readonly now: () => number = Date.now
  ) {}

  public async execute(input: UpdateLocationInput): Promise<DriverLocation> {
    const { driverId, coordinates, vehicleType, available, timestamp } = input;

    if (!Number.isInteger(driverId) || driverId <= 0) {
      throw new LocationValidationError('El driverId debe ser un número entero positivo canónico de M1');
    }

    DistanceCalculator.validateCoordinates(coordinates);

    const updatedAtMs = timestamp ? Date.parse(timestamp) : this.now();
    const maximumClockSkewMs = 30_000;

    if (updatedAtMs > this.now() + maximumClockSkewMs) {
      throw new LocationValidationError(
        'La marca temporal de la ubicación no puede estar más de 30 segundos en el futuro'
      );
    }

    const currentLocation = await this.locationRepository.get(driverId);
    if (currentLocation && updatedAtMs < Date.parse(currentLocation.updatedAt)) {
      throw new StaleLocationError(
        'La ubicación recibida es anterior a la última ubicación registrada'
      );
    }

    const updatedAt = new Date(updatedAtMs).toISOString();
    const expiresAt = new Date(updatedAtMs + this.ttlSeconds * 1000).toISOString();

    const location: DriverLocation = {
      driverId,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      vehicleType,
      available,
      updatedAt,
      expiresAt
    };

    // 1. Guardar ubicación activa en Redis cache
    const result = await this.locationRepository.saveIfNewer(location, this.ttlSeconds);

    // 2. Guardar registro en historial persistente PostgreSQL si se guardó la ubicación
    if (result.saved && this.historyRepository) {
      await this.historyRepository.saveRecord({
        driverId,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        vehicleType,
        available,
        updatedAt
      });
    }

    return result.location;
  }
}
