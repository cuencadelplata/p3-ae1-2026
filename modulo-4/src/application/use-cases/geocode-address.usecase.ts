import type { GeocodedAddress } from '../../domain/entities/location.entity.js';
import type { GeocodingProvider } from '../../ports/geocoding-provider.port.js';

export class GeocodeAddressUseCase {
  public constructor(private readonly geocodingProvider: GeocodingProvider) {}

  public async execute(address: string): Promise<GeocodedAddress> {
    return this.geocodingProvider.geocode(address);
  }
}
