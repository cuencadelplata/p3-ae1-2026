import { ServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';
import { createPolicy, type ResiliencePolicy } from '../resilience/policies.js';
import type { CustomerTripsResponse } from '../types/customer.js';

/**
 * Cliente HTTP para el módulo M6 (Viajes).
 *
 * Resiliencia (política 'm6' de resilience/policies.ts): timeout, reintentos y
 * circuit breaker. Una caída, un timeout, un 5xx o el circuito abierto se
 * convierten en ServiceUnavailableError; el caller decide si devuelve
 * respuesta degradada o propaga el 503.
 *
 * El stub (src/stubs/m6.stub.ts) acepta ?userId= y exige Authorization.
 * La URL se configura con M6_SERVICE_URL.
 */
/**
 * fetch lanza TypeError ante cualquier falla de red (socket cortado, DNS, etc.) y no todas
 * las variantes las reconoce isServiceUnavailableError. Se traducen acá; si la política
 * canceló la operación (timeout) se deja pasar tal cual.
 */
async function fetchOrUnavailable(module: string, url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: unknown) {
    if (init.signal.aborted) throw err;
    throw new ServiceUnavailableError(`${module} no disponible: ${describeError(err)}`);
  }
}

export class M6Client {
  constructor(
    private readonly baseUrl = process.env.M6_SERVICE_URL ?? 'http://localhost:3000/__stubs/m6',
    private readonly policy: ResiliencePolicy = createPolicy('m6')
  ) {}

  /**
   * Consulta el historial de viajes de un usuario en M6.
   * Reenvía el token del usuario autenticado.
   *
   * @throws {ServiceUnavailableError} si M6 no responde, da error de red o el circuito está abierto.
   */
  async getTrips(userId: number, token: string): Promise<CustomerTripsResponse> {
    const url = `${this.baseUrl}/v1/trips?userId=${encodeURIComponent(userId)}`;

    return this.policy.execute(async (signal) => {
      const response = await fetchOrUnavailable('M6', url, {
        headers: { Authorization: `Bearer ${token}` },
        signal
      });

      if (response.ok) {
        const data = (await response.json()) as { userId: number; tripsCount: number; trips: any[] };
        // M6 devuelve userId numérico; lo convertimos a string para adaptarlo al contrato interno
        return {
          customerId: String(data.userId),
          tripsCount: data.tripsCount,
          trips: data.trips,
          degraded: false
        };
      }

      if (response.status === 401) {
        throw new Error('[M6Client] Token rechazado por M6: verificar reenvío del header Authorization');
      }

      throw new ServiceUnavailableError(
        `M6 respondió ${response.status}: ${await response.text().catch(() => '')}`
      );
    }, { idempotent: true });
  }
}

export const m6Client = new M6Client();
