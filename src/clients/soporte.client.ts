import { ServiceUnavailableError, isServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';

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
 * Resiliencia:
 *  - Timeout de 5 s (AbortController).
 *  - Si Soporte está caído lanza ServiceUnavailableError → degradación elegante en el service.
 *  - Cuando Erwin suba src/resilience/policies.ts, reemplazar el try/catch
 *    por: createPolicy('soporte').execute(() => fetchPenalizaciones(...))
 */
export class SoporteClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly secretKey: string;

  constructor(
    baseUrl = process.env.SOPORTE_SERVICE_URL ?? 'http://localhost:3000/__stubs/soporte',
    timeoutMs = 5_000,
    secretKey = process.env.SOPORTE_SECRET_KEY ?? 'secret-m2'
  ) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.secretKey = secretKey;
  }

  /**
   * Consulta las penalizaciones vigentes de un usuario en Soporte.
   * Usa la secretKey del servicio, no el token del usuario.
   *
   * @throws {ServiceUnavailableError} si Soporte no responde o da error de red.
   */
  async getPenalizaciones(userId: number): Promise<PenalizacionesResponse> {
    const url = `${this.baseUrl}/usuarios/${userId}/penalizaciones`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { 'X-Secret-Key': this.secretKey },
        signal: controller.signal
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
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceUnavailableError(`Timeout al contactar Soporte (>${this.timeoutMs} ms)`);
      }
      if (isServiceUnavailableError(err)) {
        throw new ServiceUnavailableError(`Soporte no disponible: ${describeError(err)}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const soporteClient = new SoporteClient();
