import { z } from 'zod';

import { ExternalServiceError } from '../errors/external-service.error.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { getRequestContext } from '../integration/request-context.js';
import type { RouteResolver, RouteSnapshot } from '../integration/route-estimate.port.js';

const coordinates = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const estimate = z.object({
  distanceKm: z.number().positive(),
  estimatedEtaMinutes: z.number().positive(),
});

/** Contrato publicado por M4: /api/v1/geocode y /api/v1/estimate. */
export class M4RouteResolver implements RouteResolver {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  public async resolve(origin: string, destination: string): Promise<RouteSnapshot> {
    const [from, to] = await Promise.all([
      this.post('geocode', { address: origin }).then((body) => coordinates.parse(body)),
      this.post('geocode', { address: destination }).then((body) => coordinates.parse(body)),
    ]);
    const route = estimate.parse(await this.post('estimate', { origin: from, destination: to }));
    return {
      origin: { ...from, address: origin },
      destination: { ...to, address: destination },
      distanceKm: route.distanceKm,
      estimatedDurationMin: route.estimatedEtaMinutes,
    };
  }

  private async post(operation: string, body: unknown): Promise<unknown> {
    const correlationId = getRequestContext()?.correlationId;
    const response = await fetchWithTimeout(
      'M4',
      new URL(`/api/v1/${operation}`, this.baseUrl),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(correlationId === undefined ? {} : { 'x-correlation-id': correlationId }),
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
      operation,
    );
    if (!response.ok) throw ExternalServiceError.fromHttpStatus('M4', response.status);
    try {
      return await response.json();
    } catch (cause) {
      throw ExternalServiceError.badResponse('M4', cause);
    }
  }
}
