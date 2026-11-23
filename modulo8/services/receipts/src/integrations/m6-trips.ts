import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import type { VehicleType } from '../models/receipt';
import { createLogger, errorMessage } from '../observability/logger';

/**
 * Viaje finalizado segun M6, ya traducido a lo que necesita el comprobante.
 *
 * Sale de dos operaciones publicas de M6:
 * - GET /api/viajes/{id}: estado, cliente, conductor, origen y destino.
 * - GET /api/viajes?clienteId=&estado=COMPLETADO (registro de viajes, RF-6.7):
 *   los datos que M6 guarda al finalizar (inicio, fin, distancia, duracion,
 *   tipo de vehiculo, medio de pago, total y moneda).
 */
export interface CompletedTrip {
  tripId: string;
  customerId: string;
  driverId: string;
  origin: string;
  destination: string;
  startedAt: string;
  finishedAt: string;
  distanceKm: number;
  durationMin: number;
  vehicleType: VehicleType;
  /** Medio de pago informado por M6 (efectivo, tarjeta o transferencia). */
  paymentMethod: string;
  total: number;
  currency: string;
}

/**
 * M6 todavia no muestra el viaje como finalizado (o no encuentra sus datos de
 * cierre). Es transitorio: el evento se reintenta y, si sigue igual, va a la DLQ.
 */
export class TripNotReadyError extends Error {
  constructor(
    readonly tripId: string,
    message: string,
  ) {
    super(message);
    this.name = 'TripNotReadyError';
  }
}

export interface TripsClient {
  getCompletedTrip(tripId: string): Promise<CompletedTrip>;
}

export interface TripsClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Paginas del registro que se recorren buscando el viaje (100 viajes por pagina). */
  maxPages?: number;
  fetchImpl?: typeof fetch;
}

type Data = Record<string, unknown>;

const PAGE_SIZE = 100;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Direccion legible de un punto del viaje. M6 guarda el origen/destino que
 * recibio al solicitar (texto libre o un objeto serializado) y, al finalizar,
 * coordenadas con una direccion opcional. Se prefiere la direccion; sin ella,
 * el texto original; y como ultimo recurso, las coordenadas.
 */
export function describePlace(requested: unknown, atFinish: unknown): string | undefined {
  if (isObject(atFinish)) {
    const address = text(atFinish['address']);
    if (address) return address;
  }

  const raw = text(requested);
  if (raw) {
    if (!raw.startsWith('{')) return raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isObject(parsed)) {
        const address = text(parsed['address']) ?? text(parsed['direccion']);
        if (address) return address;
      }
    } catch {
      return raw;
    }
  }

  if (isObject(atFinish)) {
    const { latitude, longitude } = atFinish;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  }
  return raw;
}

/**
 * Traduce el viaje de M6 (detalle + registro con la finalizacion). Devuelve la
 * lista de campos que faltan o no cumplen el contrato si no se puede armar.
 */
export function toCompletedTrip(
  tripId: string,
  detail: Data,
  entry: Data,
): { ok: true; value: CompletedTrip } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const finish = isObject(entry['finalizacion']) ? entry['finalizacion'] : undefined;
  if (!finish) {
    return { ok: false, errors: ['finalizacion'] };
  }

  const customerId = text(detail['clienteId']);
  const driverId = text(detail['conductorId']);
  const origin = describePlace(detail['origen'], finish['origen']);
  const destination = describePlace(detail['destino'], finish['destino']);
  const finishedAt = isoDate(finish['horaFin']) ?? isoDate(detail['completadoAt']);
  const startedAt = isoDate(finish['inicio']) ?? finishedAt;
  const distanceKm = positiveNumber(finish['distanciaKm']);
  const durationMin = positiveNumber(finish['tiempoMinutos']);
  const vehicle = text(finish['tipoVehiculo'])?.toUpperCase();
  const paymentMethod = text(finish['metodoPago']);
  const total = typeof finish['total'] === 'number' && Number.isFinite(finish['total']) && finish['total'] >= 0
    ? finish['total']
    : undefined;
  const currency = (text(finish['moneda']) ?? 'ARS').toUpperCase();

  if (!customerId) errors.push('clienteId');
  if (!driverId) errors.push('conductorId');
  if (!origin) errors.push('origen');
  if (!destination) errors.push('destino');
  if (!finishedAt || !startedAt) errors.push('finalizacion.horaFin');
  if (distanceKm === undefined) errors.push('finalizacion.distanciaKm');
  if (durationMin === undefined) errors.push('finalizacion.tiempoMinutos');
  if (vehicle !== 'AUTO' && vehicle !== 'MOTO') errors.push('finalizacion.tipoVehiculo');
  if (!paymentMethod) errors.push('finalizacion.metodoPago');
  if (total === undefined) errors.push('finalizacion.total');
  if (!CURRENCY_PATTERN.test(currency)) errors.push('finalizacion.moneda');

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      tripId,
      customerId: customerId!,
      driverId: driverId!,
      origin: origin!,
      destination: destination!,
      startedAt: startedAt!,
      finishedAt: finishedAt!,
      distanceKm: distanceKm!,
      durationMin: Math.round(durationMin!),
      vehicleType: vehicle as VehicleType,
      paymentMethod: paymentMethod!,
      total: total!,
      currency,
    },
  };
}

/** Cliente REST de M6 con timeout por llamada. M6 es la fuente de verdad del viaje. */
export function createTripsClient(options: TripsClientOptions): TripsClient {
  const log = createLogger('m6-trips');
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? 5;

  function unavailable(tripId: string, reason: string, cause?: unknown): DependencyUnavailableError {
    log('warn', 'fallo la consulta del viaje a M6', { tripId, reason });
    return new DependencyUnavailableError('trips', `La API de viajes de M6 no esta disponible: ${reason}`, 5, { cause });
  }

  async function getJson(tripId: string, path: string): Promise<{ status: number; body: unknown }> {
    if (!options.baseUrl) {
      throw unavailable(tripId, 'M6_TRIPS_URL no esta configurada');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, { signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw unavailable(tripId, timedOut ? `sin respuesta en ${options.timeoutMs} ms` : errorMessage(error), error);
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status >= 500) {
      throw unavailable(tripId, `respondio ${response.status}`);
    }
    return { status: response.status, body };
  }

  return {
    async getCompletedTrip(tripId) {
      const detail = await getJson(tripId, `/api/viajes/${encodeURIComponent(tripId)}`);
      if (detail.status === 404) {
        throw new TripNotReadyError(tripId, `M6 no encuentra el viaje ${tripId}`);
      }
      if (detail.status !== 200 || !isObject(detail.body) || detail.body['id'] !== tripId) {
        throw unavailable(tripId, `respuesta inesperada del detalle (${detail.status})`);
      }
      if (detail.body['estado'] !== 'COMPLETADO') {
        throw new TripNotReadyError(tripId, `El viaje ${tripId} esta en estado ${String(detail.body['estado'])} en M6`);
      }

      const customerId = text(detail.body['clienteId']) ?? '';
      for (let page = 0; page < maxPages; page += 1) {
        const query = new URLSearchParams({
          clienteId: customerId,
          estado: 'COMPLETADO',
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        const registry = await getJson(tripId, `/api/viajes?${query.toString()}`);
        if (registry.status !== 200 || !isObject(registry.body) || !Array.isArray(registry.body['viajes'])) {
          throw unavailable(tripId, `respuesta inesperada del registro de viajes (${registry.status})`);
        }
        const trips = registry.body['viajes'] as unknown[];
        const entry = trips.find((item): item is Data => isObject(item) && item['id'] === tripId);
        if (entry) {
          const trip = toCompletedTrip(tripId, detail.body, entry);
          if (!trip.ok) {
            throw new TripNotReadyError(tripId, `M6 no informa datos del viaje ${tripId}: ${trip.errors.join(', ')}`);
          }
          return trip.value;
        }
        if (trips.length < PAGE_SIZE) break;
      }
      throw new TripNotReadyError(tripId, `El registro de viajes de M6 no incluye el viaje ${tripId}`);
    },
  };
}
