import { ServiceUnavailableError, isServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';
import type { CustomerTripsResponse } from '../types/customer.js';

/**
 * Cliente HTTP para el módulo M6 (Viajes).
 *
 * Resiliencia:
 *  - Timeout de 5 s (AbortController).
 *  - Error de red / timeout → ServiceUnavailableError → el caller decide si
 *    devuelve respuesta degradada o propaga el 503.
 *  - Cuando Erwin suba src/resilience/policies.ts, reemplazar el try/catch
 *    por: createPolicy('m6').execute(() => fetchTrips(...))
 *
 * El stub nuevo (src/stubs/m6.stub.ts) acepta ?userId= y exige Authorization.
 * La URL se configura con M6_SERVICE_URL.
 */
export class M6Client {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl = process.env.M6_SERVICE_URL ?? 'http://localhost:3000/__stubs/m6',
    timeoutMs = 5_000
  ) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Consulta el historial de viajes de un usuario en M6.
   * Reenvía el token del usuario autenticado.
   *
   * @throws {ServiceUnavailableError} si M6 no responde o da error de red.
   */
  async getTrips(userId: number, token: string): Promise<CustomerTripsResponse> {
    const url = `${this.baseUrl}/v1/trips?userId=${encodeURIComponent(userId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      if (response.ok) {
        const data = (await response.json()) as { userId: number; tripsCount: number; trips: any[] };
        // M6 devuelve userId numérico; lo convertimos a string para adaptarlo al contrato interno
        return {
          customerId: String(data.userId),
          tripsCount: data.tripsCount,
          trips: data.trips
        };
      }

      if (response.status === 401) {
        throw new Error('[M6Client] Token rechazado por M6: verificar reenvío del header Authorization');
      }

      throw new ServiceUnavailableError(
        `M6 respondió ${response.status}: ${await response.text().catch(() => '')}`
      );
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceUnavailableError(`Timeout al contactar M6 (>${this.timeoutMs} ms)`);
      }
      if (isServiceUnavailableError(err)) {
        throw new ServiceUnavailableError(`M6 no disponible: ${describeError(err)}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const m6Client = new M6Client();
