import { NOOP_RESERVATION_CACHE, type ReservationCache } from '../cache/reservation-cache.js';
import type { DispatchClient } from '../clients/m5-dispatch.client.js';
import type { EstimacionTarifa, TarifaClient } from '../clients/tarifa.client.js';
import type {
  ActualizarReserva,
  CambiosReserva,
  CrearReserva,
  Reserva,
} from '../domain/reserva.js';
import type { RouteSnapshot } from '../domain/route-snapshot.js';
import { AppError } from '../errors/app.error.js';
import type { RouteResolver } from '../integration/route-estimate.port.js';
import type { DistributedLock } from '../locks/distributed-lock.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';
import { conReservaExclusiva } from './reserva-lock.js';

const normalizarUbicacion = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase('es');

interface RouteAndFare {
  route: RouteSnapshot;
  fare: EstimacionTarifa;
}

export class ReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly tarifaClient: TarifaClient,
    private readonly routeResolver: RouteResolver,
    private readonly cache: ReservationCache = NOOP_RESERVATION_CACHE,
    private readonly distributedLock?: DistributedLock,
    private readonly dispatchClient?: DispatchClient,
  ) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    this.validarFechaFutura(input.fechaHoraProgramada);
    this.validarOrigenDestino(input.origen, input.destino);

    const pricing = await this.resolveRouteAndFare(input.origen, input.destino, input.vehiculo);
    const creada = await this.repository.crear({
      ...input,
      tarifaEstimada: pricing?.fare.tarifaEstimada ?? null,
      moneda: pricing?.fare.moneda ?? 'ARS',
      estimacionTarifaId: pricing?.fare.estimacionId ?? null,
      routeSnapshot: pricing?.route ?? null,
    });
    await this.cache.set(creada);
    return creada;
  }

  public async listar(): Promise<Reserva[]> {
    return this.repository.listar();
  }

  public async obtenerPorId(id: string): Promise<Reserva> {
    const cached = await this.cache.get(id);
    if (cached !== null) return cached;
    const reserva = await this.repository.obtenerPorId(id);
    if (reserva === null) {
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'La reserva no existe.');
    }
    await this.cache.set(reserva);
    return reserva;
  }

  public async actualizar(id: string, input: ActualizarReserva): Promise<Reserva> {
    return conReservaExclusiva(this.repository, id, () =>
      this.withDistributedLock(`lock:reserva:${id}:modificacion`, async () => {
        await this.cache.invalidate(id);
        const result = await this.actualizarExclusiva(id, input);
        await this.cache.set(result);
        return result;
      }),
    );
  }

  private async actualizarExclusiva(id: string, input: ActualizarReserva): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA') {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'Solo se pueden modificar reservas PROGRAMADA.',
      );
    }

    const origen = input.origen ?? actual.origen;
    const destino = input.destino ?? actual.destino;
    const vehiculo = input.vehiculo ?? actual.vehiculo;
    const fecha = input.fechaHoraProgramada ?? actual.fechaHoraProgramada;
    this.validarOrigenDestino(origen, destino);
    this.validarFechaFutura(fecha);

    const cambios: CambiosReserva = { ...input };
    const cambiaRecorrido = input.origen !== undefined || input.destino !== undefined;
    const requiereNuevaTarifa = cambiaRecorrido || input.vehiculo !== undefined;

    if (requiereNuevaTarifa) {
      let route = cambiaRecorrido ? null : actual.routeSnapshot;
      try {
        route ??= await this.routeResolver.resolve(origen, destino);
        const fare = await this.tarifaClient.estimar({ vehiculo, route });
        cambios.routeSnapshot = route;
        cambios.tarifaEstimada = fare.tarifaEstimada;
        cambios.moneda = fare.moneda;
        cambios.estimacionTarifaId = fare.estimacionId;
      } catch {
        if (cambiaRecorrido) cambios.routeSnapshot = null;
        cambios.tarifaEstimada = null;
        cambios.moneda = actual.moneda ?? 'ARS';
        cambios.estimacionTarifaId = null;
      }
    }

    const actualizada = await this.repository.actualizarProgramada(id, cambios);
    if (actualizada === null) {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'La reserva dejó de estar disponible para modificación.',
      );
    }
    return actualizada;
  }

  public async cancelar(id: string): Promise<Reserva> {
    return conReservaExclusiva(this.repository, id, () =>
      this.withDistributedLock(`lock:reserva:${id}:activacion`, async () => {
        await this.cache.invalidate(id);
        const result = await this.cancelarExclusiva(id);
        await this.cache.set(result);
        return result;
      }),
    );
  }

  private async cancelarExclusiva(id: string): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA' && actual.estado !== 'ACTIVANDO') {
      throw new AppError(
        409,
        'RESERVA_NO_CANCELABLE',
        'Solo se pueden cancelar reservas PROGRAMADA o ACTIVANDO.',
      );
    }

    if (actual.estado === 'ACTIVANDO' && actual.idSolicitud === null) {
      throw new AppError(
        409,
        'RESERVA_EN_PROCESO',
        'La reserva ya está siendo enviada a despacho y todavía no puede cancelarse.',
      );
    }

    if (actual.idSolicitud !== null) {
      if (this.dispatchClient === undefined) {
        throw new AppError(
          503,
          'DESPACHO_NO_CONFIGURADO',
          'No se puede cancelar la solicitud de despacho en este momento.',
        );
      }
      await this.dispatchClient.cancelRequest(actual.idSolicitud, 'Reserva cancelada en M9');
    }

    const cancelada = await this.repository.cancelar(id, actual.estado);
    if (cancelada === null) {
      throw new AppError(
        409,
        'RESERVA_NO_CANCELABLE',
        'La reserva dejó de estar disponible para cancelación.',
      );
    }
    return cancelada;
  }

  private async resolveRouteAndFare(
    origin: string,
    destination: string,
    vehiculo: CrearReserva['vehiculo'],
  ): Promise<RouteAndFare | null> {
    try {
      const route = await this.routeResolver.resolve(origin, destination);
      const fare = await this.tarifaClient.estimar({ vehiculo, route });
      return { route, fare };
    } catch {
      // Política de degradación existente: la reserva puede guardarse sin tarifa.
      return null;
    }
  }

  private async withDistributedLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    return this.distributedLock === undefined
      ? action()
      : this.distributedLock.runExclusive(key, action);
  }

  private validarFechaFutura(fecha: string): void {
    if (!Number.isFinite(Date.parse(fecha)) || Date.parse(fecha) <= Date.now()) {
      throw new AppError(
        400,
        'FECHA_INVALIDA',
        'La fecha y hora programada debe ser válida y futura.',
      );
    }
  }

  private validarOrigenDestino(origen: string, destino: string): void {
    if (normalizarUbicacion(origen) === normalizarUbicacion(destino)) {
      throw new AppError(400, 'DATOS_INVALIDOS', 'El origen y el destino deben ser diferentes.');
    }
  }
}
