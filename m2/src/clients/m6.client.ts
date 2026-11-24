import { z } from 'zod';
import { ServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';
import { createPolicy, type ResiliencePolicy } from '../resilience/policies.js';
import type { CustomerTripsResponse, TripSummary } from '../types/customer.js';

/**
 * Respuesta de M6 (m6_viajes/openapi.yaml, ViajesClienteResponse):
 * GET /api/clientes/{clienteId}/viajes → { clienteId, viajes: [...] }.
 * Se validan solo los campos que usa M2; los demás (historialTransiciones,
 * datos de finalización) se ignoran.
 */
const M6ViajeSchema = z.object({
  id: z.string().min(1),
  estado: z.string().min(1),
  origen: z.string().nullish(),
  destino: z.string().nullish(),
  fechaCreacion: z.string().nullish(),
  finalizacion: z.object({
    total: z.number().nullish(),
    horaFin: z.string().nullish()
  }).nullish()
});

const M6ViajesClienteSchema = z.object({
  clienteId: z.string(),
  viajes: z.array(M6ViajeSchema)
});

type M6Viaje = z.infer<typeof M6ViajeSchema>;

function toTripSummary(viaje: M6Viaje): TripSummary {
  return {
    tripId: viaje.id,
    origin: viaje.origen ?? '',
    destination: viaje.destino ?? '',
    // La tarifa existe solo cuando el viaje terminó (finalizacion.total)
    fare: viaje.finalizacion?.total ?? null,
    status: viaje.estado,
    createdAt: viaje.fechaCreacion ?? viaje.finalizacion?.horaFin ?? ''
  };
}

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

/**
 * Cliente HTTP para el módulo M6 (Viajes).
 *
 * Contrato: GET {M6_SERVICE_URL}/api/clientes/{clienteId}/viajes, sin autenticación
 * (M6 lo expone solo a consumidores de confianza en la red). El clienteId de M6 es
 * el userId de M1 como texto, igual que en RF-2.2 / RF-2.4.
 *
 * Resiliencia (política 'm6' de resilience/policies.ts): timeout, reintentos y
 * circuit breaker. Una caída, un timeout, un 5xx (M6 responde 503 si su base está
 * caída) o el circuito abierto se convierten en ServiceUnavailableError; el caller
 * devuelve una respuesta degradada.
 */
export class M6Client {
  constructor(
    private readonly baseUrl = process.env.M6_SERVICE_URL ?? 'http://localhost:3000/__stubs/m6',
    private readonly policy: ResiliencePolicy = createPolicy('m6')
  ) {}

  /**
   * Consulta los viajes de un usuario en M6.
   *
   * @throws {ServiceUnavailableError} si M6 no responde, da error de red o el circuito está abierto.
   */
  async getTrips(userId: number): Promise<CustomerTripsResponse> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/api/clientes/${encodeURIComponent(String(userId))}/viajes`;

    return this.policy.execute(async (signal) => {
      const response = await fetchOrUnavailable('M6', url, {
        headers: { Accept: 'application/json' },
        signal
      });

      if (response.ok) {
        const parsed = M6ViajesClienteSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error(`[M6Client] Respuesta de M6 fuera de contrato: ${parsed.error.message}`);
        }
        const trips = parsed.data.viajes.map(toTripSummary);
        return {
          customerId: parsed.data.clienteId,
          tripsCount: trips.length,
          trips,
          degraded: false
        };
      }

      if (response.status >= 500) {
        throw new ServiceUnavailableError(
          `M6 respondió ${response.status}: ${await response.text().catch(() => '')}`
        );
      }

      throw new Error(`[M6Client] M6 rechazó la consulta (${response.status}): ${await response.text().catch(() => '')}`);
    }, { idempotent: true });
  }
}

export const m6Client = new M6Client();
