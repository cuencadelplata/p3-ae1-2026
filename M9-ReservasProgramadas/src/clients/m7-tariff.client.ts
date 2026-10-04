import { z } from 'zod';

import type { TipoVehiculo } from '../domain/reserva.js';
import { ExternalServiceError } from '../errors/external-service.error.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { getRequestContext } from '../integration/request-context.js';
import type { RouteSnapshot } from '../domain/route-snapshot.js';
import type { EstimacionTarifa, SolicitudTarifa, TarifaClient } from './tarifa.client.js';

const responseSchema = z.object({
  estimacionId: z.string().min(1),
  distanciaKm: z.number().nonnegative(),
  tiempoEstimadoMin: z.number().nonnegative(),
  estimatedFare: z.number().nonnegative(),
  currency: z.string().min(1),
  calculadoEn: z.string().datetime({ offset: true }),
});

export interface M7TariffInput {
  vehiculo: TipoVehiculo;
  route: RouteSnapshot;
}

export const toM7TariffRequest = ({ vehiculo, route }: M7TariffInput) => ({
  origen: {
    lat: route.origin.latitude,
    lng: route.origin.longitude,
    direccion: route.origin.address,
  },
  destino: {
    lat: route.destination.latitude,
    lng: route.destination.longitude,
    direccion: route.destination.address,
  },
  distanciaKm: route.distanceKm,
  tiempoEstimadoMin: route.estimatedDurationMin,
  vehicleType: vehiculo === 'AUTO' ? ('auto' as const) : ('moto' as const),
});

export class M7TariffClient implements TarifaClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async estimar(input: SolicitudTarifa): Promise<EstimacionTarifa> {
    const correlationId = getRequestContext()?.correlationId;
    const response = await fetchWithTimeout(
      'M7',
      new URL('/tarifa/estimacion', this.baseUrl),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(correlationId === undefined ? {} : { 'x-correlation-id': correlationId }),
        },
        body: JSON.stringify(toM7TariffRequest(input)),
      },
      this.timeoutMs,
    );
    if (!response.ok) throw ExternalServiceError.fromHttpStatus('M7', response.status);
    try {
      const parsed = responseSchema.parse(await response.json());
      return {
        tarifaEstimada: parsed.estimatedFare,
        moneda: parsed.currency,
        estimacionId: parsed.estimacionId,
        distanciaKm: parsed.distanciaKm,
        tiempoEstimadoMin: parsed.tiempoEstimadoMin,
        calculadoEn: parsed.calculadoEn,
      };
    } catch (cause) {
      throw ExternalServiceError.badResponse('M7', cause);
    }
  }

  public async estimate(input: M7TariffInput): Promise<EstimacionTarifa> {
    return this.estimar(input);
  }
}
