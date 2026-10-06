import { describe, expect, it } from 'vitest';
import { GeocodingNotFoundError, GeocodingTimeoutError } from '../../src/domain/errors/location.errors.js';
import { MockGeocodingAdapter } from '../../src/infrastructure/geocoding/mock-geocoding.adapter.js';

describe('GeocodingAdapter (RF-4.4 / RNF-14)', () => {
  const adapter = new MockGeocodingAdapter();

  it('debe geocodificar exitosamente una dirección conocida', async () => {
    const result = await adapter.geocode('Plaza 25 de Mayo, Corrientes');

    expect(result.latitude).toBeCloseTo(-27.4684, 3);
    expect(result.longitude).toBeCloseTo(-58.8341, 3);
    expect(result.provider).toBe('SIMULATED');
  });

  it('debe lanzar GeocodingNotFoundError si la dirección no se encuentra (404)', async () => {
    await expect(adapter.geocode('Direccion Inexistente 99999')).rejects.toThrow(
      GeocodingNotFoundError
    );
  });

  it('debe lanzar GeocodingTimeoutError si se agota el tiempo de espera (504)', async () => {
    await expect(adapter.geocode('trigger-timeout')).rejects.toThrow(
      GeocodingTimeoutError
    );
  });
});
