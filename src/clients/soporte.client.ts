import { ServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';
import { createPolicy, type ResiliencePolicy } from '../resilience/policies.js';

/**
 * Respuesta del endpoint de penalizaciones de Soporte.
 */
export type Penalizacion = {
  ticketId: string;
  tripId: string;
  motivo: string;
  fecha: string;
};

export type PenalizacionesResponse = {
  userId: number;
  total: number;
  penalizaciones: Penalizacion[];
};

/**
 * Cliente HTTP para el módulo de Soporte (penalizaciones vigentes).
 *
 * Autenticación: usa la SOPORTE_SECRET_KEY del entorno (no el token del usuario).
 * Soporte es una llamada interna de servicio a servicio.
 *
 * Resiliencia (política 'soporte' de resilience/policies.ts): timeout, reintentos y
 * circuit breaker. Si Soporte está caído lanza ServiceUnavailableError →
 * degradación elegante en el service.
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

export class SoporteClient {
  constructor(
    private readonly baseUrl = process.env.SOPORTE_SERVICE_URL ?? 'http://localhost:3000/__stubs/soporte',
    private readonly secretKey = process.env.SOPORTE_SECRET_KEY ?? 'secret-m2',
    private readonly policy: ResiliencePolicy = createPolicy('soporte')
  ) {}

  /**
   * Consulta las penalizaciones vigentes de un usuario en Soporte.
   * Usa la secretKey del servicio, no el token del usuario.
   *
   * @throws {ServiceUnavailableError} si Soporte no responde, da error de red o el circuito está abierto.
   */
  async getPenalizaciones(userId: number): Promise<PenalizacionesResponse> {
    const url = `${this.baseUrl}/usuarios/${userId}/penalizaciones`;

    return this.policy.execute(async (signal) => {
      const response = await fetchOrUnavailable('Soporte', url, {
        headers: { 'X-Secret-Key': this.secretKey },
        signal
      });

      if (response.ok) {
        return (await response.json()) as PenalizacionesResponse;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(`[SoporteClient] Acceso denegado por Soporte (${response.status}): verificar SOPORTE_SECRET_KEY`);
      }

      throw new ServiceUnavailableError(
        `Soporte respondió ${response.status}: ${await response.text().catch(() => '')}`
      );
    }, { idempotent: true });
  }
}

export const soporteClient = new SoporteClient();
