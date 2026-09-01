import type {
  Coordinates,
  DistanceEstimate,
  DriverLocation,
  NearbyDriver,
  VehicleType
} from '../types/location.types.js';

export class NotFoundError extends Error {}
export class LocationValidationError extends Error {}

export class LocationService {
  private readonly locations = new Map<string, DriverLocation>();

  public constructor(
    private readonly ttlSeconds = 60,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new LocationValidationError('LOCATION_TTL_SECONDS debe ser un numero mayor a cero');
    }
  }

  public updateLocation(
    driverId: string,
    coordinates: Coordinates,
    vehicleType: VehicleType,
    available: boolean,
    timestamp?: string
  ): DriverLocation {
    const updatedAtMs = timestamp ? Date.parse(timestamp) : this.now();
    const maximumClockSkewMs = 30_000;

    if (updatedAtMs > this.now() + maximumClockSkewMs) {
      throw new LocationValidationError(
        'La marca temporal de la ubicacion no puede estar mas de 30 segundos en el futuro'
      );
    }

    const updatedAt = new Date(updatedAtMs).toISOString();
    const location: DriverLocation = {
      driverId,
      ...coordinates,
      vehicleType,
      available,
      updatedAt,
      expiresAt: new Date(updatedAtMs + this.ttlSeconds * 1000).toISOString()
    };

    this.locations.set(driverId, location);
    return location;
  }

  public updateAvailability(driverId: string, available: boolean): DriverLocation {
    const location = this.getActiveLocation(driverId);
    const updated: DriverLocation = { ...location, available };
    this.locations.set(driverId, updated);
    return updated;
  }

  public getActiveLocation(driverId: string): DriverLocation {
    const location = this.locations.get(driverId);
    if (!location || this.isExpired(location)) {
      this.locations.delete(driverId);
      throw new NotFoundError('Ubicacion activa no encontrada para el conductor');
    }
    return location;
  }

  public removeLocation(driverId: string): void {
    this.getActiveLocation(driverId);
    this.locations.delete(driverId);
  }

  public findNearby(
    origin: Coordinates,
    vehicleType: VehicleType,
    radiusKm: number,
    limit: number
  ): NearbyDriver[] {
    this.removeExpiredLocations();

    return Array.from(this.locations.values())
      .filter((location) => location.available && location.vehicleType === vehicleType)
      .map((location) => {
        const estimate = this.estimate(origin, location);
        return { ...location, ...estimate };
      })
      .filter((location) => location.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }

  public geocode(address: string): Coordinates & { address: string; provider: string } {
    const normalized = address.trim().toLowerCase();
    const knownAddresses: Record<string, Coordinates> = {
      'facultad cuenca del plata': { latitude: -27.4692, longitude: -58.8306 },
      'plaza 25 de mayo, corrientes': { latitude: -27.4684, longitude: -58.8341 },
      'terminal de corrientes': { latitude: -27.4875, longitude: -58.7896 }
    };
    const coordinates = knownAddresses[normalized];
    if (!coordinates) {
      throw new NotFoundError('Direccion no encontrada por el geocodificador simulado');
    }
    return { address: address.trim(), ...coordinates, provider: 'SIMULATED' };
  }

  public estimate(origin: Coordinates, destination: Coordinates): DistanceEstimate {
    const distanceKm = this.haversineDistance(origin, destination);
    return {
      distanceKm: Math.round(distanceKm * 100) / 100,
      estimatedEtaMinutes: Math.max(1, Math.ceil((distanceKm / 25) * 60))
    };
  }

  public clear(): void {
    this.locations.clear();
  }

  private removeExpiredLocations(): void {
    for (const [driverId, location] of this.locations) {
      if (this.isExpired(location)) this.locations.delete(driverId);
    }
  }

  private isExpired(location: DriverLocation): boolean {
    return new Date(location.expiresAt).getTime() <= this.now();
  }

  private haversineDistance(pointA: Coordinates, pointB: Coordinates): number {
    const earthRadiusKm = 6371;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = toRadians(pointB.latitude - pointA.latitude);
    const longitudeDelta = toRadians(pointB.longitude - pointA.longitude);
    const latitudeA = toRadians(pointA.latitude);
    const latitudeB = toRadians(pointB.latitude);
    const value =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }
}
