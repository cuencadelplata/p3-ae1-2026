import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import type { Driver, VehicleType } from '../models/receipt';
import { createLogger, errorMessage } from '../observability/logger';

/**
 * M3 no tiene los datos del conductor o de su vehiculo que el comprobante
 * necesita. Se reintenta (el alta puede estar en curso) y, si sigue igual, el
 * evento va a la DLQ.
 */
export class DriverDataMissingError extends Error {
  constructor(
    readonly driverUserId: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriverDataMissingError';
  }
}

export interface DriversClient {
  /** Nombre del conductor y vehiculo activo del tipo usado en el viaje. */
  getDriver(driverUserId: number, vehicleType: VehicleType): Promise<Driver>;
}

export interface DriversClientOptions {
  conductorBaseUrl: string;
  vehiclesBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type Data = Record<string, unknown>;

function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Cliente REST de M3:
 * - GET {conductor}/api/conductores/{userId} -> { usuarioID, ciudad, tipovehiculo, habilitado, ... }.
 *   M3 no guarda nombre ni apellido (son de M1): si algun dia los informa
 *   (nombre/apellido), se imprimen; si no, el PDF muestra el numero de usuario.
 * - GET {vehiculos}/api/v1/drivers/{userId}/vehicles -> [{ driverId, activo, tipoServicio, patente, marca, modelo }]
 *   El vehiculo activo del tipo del viaje es obligatorio para el comprobante.
 */
export function createDriversClient(options: DriversClientOptions): DriversClient {
  const log = createLogger('m3-drivers');
  const fetchImpl = options.fetchImpl ?? fetch;

  function unavailable(driverUserId: number, reason: string, cause?: unknown): DependencyUnavailableError {
    log('warn', 'fallo la consulta del conductor a M3', { driverUserId, reason });
    return new DependencyUnavailableError('drivers', `La API de conductores de M3 no esta disponible: ${reason}`, 5, {
      cause,
    });
  }

  async function getJson(driverUserId: number, baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
    if (!baseUrl) {
      throw unavailable(driverUserId, 'la URL de M3 no esta configurada');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw unavailable(driverUserId, timedOut ? `sin respuesta en ${options.timeoutMs} ms` : errorMessage(error), error);
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status >= 500) {
      throw unavailable(driverUserId, `respondio ${response.status}`);
    }
    return { status: response.status, body };
  }

  return {
    async getDriver(driverUserId, vehicleType) {
      const profile = await getJson(driverUserId, options.conductorBaseUrl, `/api/conductores/${driverUserId}`);
      if (profile.status === 404) {
        throw new DriverDataMissingError(driverUserId, `M3 no tiene registrado al conductor ${driverUserId}`);
      }
      const profileId = isObject(profile.body) ? (profile.body['usuarioID'] ?? profile.body['id']) : undefined;
      if (profile.status !== 200 || !isObject(profile.body) || String(profileId) !== String(driverUserId)) {
        throw unavailable(driverUserId, `respuesta inesperada del perfil (${profile.status})`);
      }
      const firstName = text(profile.body['nombre']);
      const lastName = text(profile.body['apellido']);
      const fullName = firstName && lastName ? `${firstName} ${lastName}` : undefined;

      const vehicles = await getJson(driverUserId, options.vehiclesBaseUrl, `/api/v1/drivers/${driverUserId}/vehicles`);
      if (vehicles.status === 404) {
        throw new DriverDataMissingError(driverUserId, `M3 no tiene vehiculos del conductor ${driverUserId}`);
      }
      if (vehicles.status !== 200 || !Array.isArray(vehicles.body)) {
        throw unavailable(driverUserId, `respuesta inesperada de vehiculos (${vehicles.status})`);
      }
      const active = (vehicles.body as unknown[]).filter(
        (item): item is Data =>
          isObject(item) &&
          item['activo'] === true &&
          item['tipoServicio'] === vehicleType &&
          String(item['driverId']) === String(driverUserId) &&
          text(item['patente']) !== undefined,
      );
      if (active.length === 0) {
        throw new DriverDataMissingError(
          driverUserId,
          `M3 no informa un vehiculo ${vehicleType} activo del conductor ${driverUserId}`,
        );
      }
      if (active.length > 1) {
        log('warn', 'el conductor tiene mas de un vehiculo activo del tipo; se usa el primero', {
          driverUserId,
          vehicleType,
          count: active.length,
        });
      }

      const vehicle = active[0]!;
      const model = [text(vehicle['marca']), text(vehicle['modelo'])].filter(Boolean).join(' ');
      return {
        id: String(driverUserId),
        ...(fullName ? { fullName } : {}),
        vehicle: {
          type: vehicleType,
          plate: text(vehicle['patente'])!.toUpperCase(),
          ...(model ? { model } : {}),
        },
      };
    },
  };
}
