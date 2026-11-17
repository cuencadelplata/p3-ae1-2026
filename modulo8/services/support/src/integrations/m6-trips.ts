import { tripServiceUnavailable } from '../errors/support-error.js';

// Consulta de existencia de un viaje. M6 es el dueño del viaje: Support sólo
// pregunta si existe, no lee su estado ni lo modifica.
export interface TripVerifier {
  // true si M6 conoce el viaje, false si no. Si no se puede saber (M6 caído,
  // lento o con una respuesta fuera de contrato) lanza
  // SUPPORT_TRIP_SERVICE_UNAVAILABLE.
  existe(tripId: string): Promise<boolean>;
  // Verificación de salud de M6, para el readiness.
  isReachable(): Promise<boolean>;
}

export interface M6TripsClientOptions {
  baseUrl: string;
  timeoutMs: number;
  // Inyectable para las pruebas.
  fetchImpl?: typeof fetch;
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function esTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

// Un cuerpo que no es JSON queda como null (fuera de contrato), pero un
// timeout mientras se lee el cuerpo sigue siendo un timeout.
async function leerJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (esTimeout(error)) {
      throw error;
    }
    return null;
  }
}

// Cliente REST de M6 (GET /api/viajes/{id}) con timeout por llamada.
//
// - 200 con el mismo id: el viaje existe.
// - 404, o 400 por un id con formato inválido: el viaje no existe.
// - Timeout, error de red, otro status o un cuerpo fuera de contrato: no se
//   pudo verificar.
export function createM6TripsClient({ baseUrl, timeoutMs, fetchImpl = fetch }: M6TripsClientOptions): TripVerifier {
  function noDisponible(tripId: string, motivo: string, cause?: unknown) {
    console.warn('[Support] No se pudo verificar el viaje en M6:', { tripId, motivo });
    return tripServiceUnavailable(cause ?? new Error(motivo));
  }

  return {
    async existe(tripId) {
      let response: Response;
      let body: unknown;
      try {
        response = await fetchImpl(`${baseUrl}/api/viajes/${encodeURIComponent(tripId)}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        body = await leerJson(response);
      } catch (error) {
        throw noDisponible(tripId, esTimeout(error) ? `sin respuesta en ${timeoutMs} ms` : describir(error), error);
      }

      if (response.status === 404 || response.status === 400) {
        return false;
      }
      if (!response.ok) {
        throw noDisponible(tripId, `M6 respondió ${response.status}`);
      }
      if (typeof body !== 'object' || body === null || (body as { id?: unknown }).id !== tripId) {
        throw noDisponible(tripId, 'respuesta con formato inesperado');
      }
      return true;
    },

    async isReachable() {
      try {
        const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        // Sólo importa el status: el cuerpo se descarta para liberar la conexión.
        await response.body?.cancel().catch(() => undefined);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
