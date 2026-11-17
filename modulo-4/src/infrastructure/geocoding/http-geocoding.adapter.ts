import type { GeocodedAddress } from '../../domain/entities/location.entity.js';
import {
  GeocodingNotFoundError,
  GeocodingProviderError,
  GeocodingTimeoutError
} from '../../domain/errors/location.errors.js';
import type { GeocodingProvider } from '../../ports/geocoding-provider.port.js';
import { Logger } from '../logger/structured.logger.js';

export class HttpGeocodingAdapter implements GeocodingProvider {
  public constructor(
    private readonly providerUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number = 5000
  ) {}

  public async geocode(address: string): Promise<GeocodedAddress> {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      throw new GeocodingNotFoundError(address);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.providerUrl);
      url.searchParams.append('q', trimmedAddress);
      url.searchParams.append('format', 'json');
      url.searchParams.append('limit', '1');

      if (this.apiKey) {
        url.searchParams.append('key', this.apiKey);
      }

      Logger.info(`Consultando servicio externo de geocodificación para: ${trimmedAddress}`, {
        url: url.toString()
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'M4-Location-Service/2.0 (plataforma-movilidad)',
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new GeocodingNotFoundError(trimmedAddress);
        }
        throw new GeocodingProviderError(
          `El proveedor externo respondió con código HTTP ${response.status}`
        );
      }

      const data = (await response.json()) as Array<{ lat: string; lon: string; display_name?: string }>;

      if (!Array.isArray(data) || data.length === 0) {
        throw new GeocodingNotFoundError(trimmedAddress);
      }

      const firstResult = data[0];
      const latitude = Number.parseFloat(firstResult.lat);
      const longitude = Number.parseFloat(firstResult.lon);

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw new GeocodingProviderError('Las coordenadas devueltas por el proveedor no son números válidos');
      }

      return {
        address: trimmedAddress,
        latitude,
        longitude,
        provider: 'EXTERNAL_HTTP'
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof GeocodingNotFoundError || error instanceof GeocodingProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        Logger.error(`Timeout al geocodificar dirección '${trimmedAddress}'`, error, { timeoutMs: this.timeoutMs });
        throw new GeocodingTimeoutError(this.timeoutMs);
      }

      Logger.error(`Falla inesperada en geocodificador externo para '${trimmedAddress}'`, error);
      throw new GeocodingProviderError(
        error instanceof Error ? error.message : 'Error desconocido al conectar con el geocodificador'
      );
    }
  }
}
