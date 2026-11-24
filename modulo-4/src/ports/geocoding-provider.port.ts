import type { GeocodedAddress } from '../domain/entities/location.entity.js';

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodedAddress>;
}
