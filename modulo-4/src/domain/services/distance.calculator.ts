import type { Coordinates, DistanceEstimate } from '../entities/location.entity.js';
import { InvalidCoordinatesError } from '../errors/location.errors.js';

export class DistanceCalculator {
  /**
   * Valida que una coordenada esté dentro de los rangos válidos del globo terráqueo:
   * Latitud entre -90 y 90, Longitud entre -180 y 180.
   */
  public static validateCoordinates(coords: Coordinates): void {
    if (
      typeof coords?.latitude !== 'number' ||
      typeof coords?.longitude !== 'number' ||
      Number.isNaN(coords.latitude) ||
      Number.isNaN(coords.longitude) ||
      coords.latitude < -90 ||
      coords.latitude > 90 ||
      coords.longitude < -180 ||
      coords.longitude > 180
    ) {
      throw new InvalidCoordinatesError(
        `Coordenadas inválidas: latitud=${coords?.latitude}, longitud=${coords?.longitude}`
      );
    }
  }

  /**
   * Calcula la distancia en kilómetros entre dos coordenadas usando la fórmula de Haversine.
   */
  public static haversineDistance(origin: Coordinates, destination: Coordinates): number {
    this.validateCoordinates(origin);
    this.validateCoordinates(destination);

    const earthRadiusKm = 6371;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    const latitudeDelta = toRadians(destination.latitude - origin.latitude);
    const longitudeDelta = toRadians(destination.longitude - origin.longitude);
    const latitudeOrigin = toRadians(origin.latitude);
    const latitudeDestination = toRadians(destination.latitude);

    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitudeOrigin) * Math.cos(latitudeDestination) * Math.sin(longitudeDelta / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  /**
   * Calcula la distancia estimada (en km) y el ETA (en minutos) basándose en una velocidad promedio.
   * @param averageSpeedKmH Velocidad promedio urbana (por defecto 25 km/h).
   */
  public static estimate(
    origin: Coordinates,
    destination: Coordinates,
    averageSpeedKmH = 25
  ): DistanceEstimate {
    const rawDistanceKm = this.haversineDistance(origin, destination);
    const distanceKm = Math.round(rawDistanceKm * 100) / 100;
    const estimatedEtaMinutes = Math.max(1, Math.ceil((rawDistanceKm / averageSpeedKmH) * 60));

    return {
      distanceKm,
      estimatedEtaMinutes
    };
  }
}
