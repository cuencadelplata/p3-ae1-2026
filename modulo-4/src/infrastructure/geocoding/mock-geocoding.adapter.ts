import type { GeocodedAddress } from '../../domain/entities/location.entity.js';
import { GeocodingNotFoundError, GeocodingTimeoutError } from '../../domain/errors/location.errors.js';
import type { GeocodingProvider } from '../../ports/geocoding-provider.port.js';

export class MockGeocodingAdapter implements GeocodingProvider {
  private readonly knownAddresses: Record<string, { latitude: number; longitude: number }> = {
    'facultad cuenca del plata': { latitude: -27.4692, longitude: -58.8306 },
    'plaza 25 de mayo, corrientes': { latitude: -27.4684, longitude: -58.8341 },
    'terminal de corrientes': { latitude: -27.4875, longitude: -58.7896 },
    'obelisco, buenos aires': { latitude: -34.6037, longitude: -58.3816 }
  };

  public async geocode(address: string): Promise<GeocodedAddress> {
    const normalized = address.trim().toLowerCase();

    if (normalized === 'trigger-timeout') {
      throw new GeocodingTimeoutError(5000);
    }

    const coordinates = this.knownAddresses[normalized];
    if (!coordinates) {
      throw new GeocodingNotFoundError(address);
    }

    return {
      address: address.trim(),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      provider: 'SIMULATED'
    };
  }
}
