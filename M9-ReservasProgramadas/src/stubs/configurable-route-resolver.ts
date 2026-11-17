import type { RouteSnapshot } from '../domain/route-snapshot.js';
import type { RouteResolver } from '../integration/route-estimate.port.js';

export interface StubRouteConfiguration {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  distanceKm: number;
  estimatedDurationMin: number;
}

/**
 * Doble controlado para pruebas locales/E2E. Las coordenadas no están hardcodeadas:
 * deben proporcionarse explícitamente mediante configuración.
 */
export class ConfigurableStubRouteResolver implements RouteResolver {
  public constructor(private readonly configuration: StubRouteConfiguration) {}

  public async resolve(origin: string, destination: string): Promise<RouteSnapshot> {
    return {
      origin: {
        address: origin,
        latitude: this.configuration.originLatitude,
        longitude: this.configuration.originLongitude,
      },
      destination: {
        address: destination,
        latitude: this.configuration.destinationLatitude,
        longitude: this.configuration.destinationLongitude,
      },
      distanceKm: this.configuration.distanceKm,
      estimatedDurationMin: this.configuration.estimatedDurationMin,
    };
  }
}
