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
import { ExternalServiceError } from '../errors/external-service.error.js';
import type { RouteResolver } from '../integration/route-estimate.port.js';
import type { DistributedLock } from '../locks/distributed-lock.js';
import {
  recordPricingDegradation,
  recordReservationOperation,
  type DegradationCause,
  type ReservationOperation,
} from '../observability/metrics.js';
import { withSpan } from '../observability/tracing.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';
import { conReservaExclusiva } from './reserva-lock.js';

/** Causa acotada de una degradación de tarifa/ruta (sin mensajes ni datos de clientes). */
export const degradationCause = (stage: 'route' | 'fare', error: unknown): DegradationCause => {
  if (stage === 'route') return 'route_unavailable';
  if (error instanceof ExternalServiceError) {
    if (error.kind === 'TIMEOUT') return 'm7_timeout';
    if (error.kind === 'UNAVAILABLE') return 'm7_unavailable';
    if (error.kind === 'BAD_RESPONSE') return 'm7_bad_response';
    return 'm7_rejected';
  }
  return 'unknown';
};

/**
 * Cuenta la operación DESPUÉS de que el repositorio confirmó la transacción. Los rechazos de
 * negocio (4xx) se separan de los errores (5xx/inesperados) y nunca se cuentan como éxito.
 */
const measured = async <T>(operation: ReservationOperation, action: () => Promise<T>): Promise<T> =>
  withSpan(`ReservaService.${operation}`, async () => {
    try {
      const result = await action();
      recordReservationOperation(operation, 'success');
      return result;
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        recordReservationOperation(operation, 'rejected', error.code);
      } else {
        recordReservationOperation(
          operation,
          'error',
          error instanceof AppError ? error.code : 'UNEXPECTED',
        );
      }
      throw error;
    }
  });

const normalizarUbicacion = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase('es');

interface RouteAndFare {
  route: RouteSnapshot;
  fare: EstimacionTarifa;
}

type PricingResult =
  { pricing: RouteAndFare; cause: null } | { pricing: null; cause: DegradationCause };

export class ReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly tarifaClient: TarifaClient,
    private readonly routeResolver: RouteResolver,
    private readonly cache: ReservationCache = NOOP_RESERVATION_CACHE,
    private readonly distributedLock?: DistributedLock,
    private readonly dispatchClient?: DispatchClient,
    private readonly demoClientId?: string,
  ) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    return measured('create', () => this.crearMedida(input));
  }

  private async crearMedida(input: CrearReserva): Promise<Reserva> {
    if (this.demoClientId !== undefined && input.clienteId !== this.demoClientId) {
      throw new AppError(
        403,
        'CLIENTE_DEMO_REQUERIDO',
        `Esta demostración admite únicamente el cliente ${this.demoClientId}.`,
      );
    }
    this.validarFechaFutura(input.fechaHoraProgramada);
    this.validarOrigenDestino(input.origen, input.destino);

    const { pricing, cause } = await this.resolveRouteAndFare(
      input.origen,
      input.destino,
      input.vehiculo,
    );
    const creada = await this.repository.crear({
      ...input,
      tarifaEstimada: pricing?.fare.tarifaEstimada ?? null,
      moneda: pricing?.fare.moneda ?? 'ARS',
      estimacionTarifaId: pricing?.fare.estimacionId ?? null,
      routeSnapshot: pricing?.route ?? null,
    });
    // La reserva ya persistió: la degradación se informa aunque HTTP responda 201.
    if (cause !== null) recordPricingDegradation('create', cause);
    await this.cache.set(creada);
    return creada;
  }

  public async listar(): Promise<Reserva[]> {
    return withSpan('ReservaService.list', () => this.repository.listar());
  }

  public async listarPaginado(
    page: number,
    pageSize: number,
    clienteId?: string,
  ): Promise<Reserva[]> {
    return withSpan('ReservaService.list_page', () =>
      this.repository.listarPaginado(page, pageSize, clienteId),
    );
  }

  public async obtenerPorId(id: string, clienteId?: string): Promise<Reserva> {
    return withSpan('ReservaService.get', () => this.obtenerPorIdInterno(id, clienteId));
  }

  private async obtenerPorIdInterno(id: string, clienteId?: string): Promise<Reserva> {
    const cached = await this.cache.get(id);
    if (cached !== null) {
      this.assertOwner(cached, clienteId);
      return cached;
    }
    const reserva = await this.repository.obtenerPorId(id);
    if (reserva === null) {
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'La reserva no existe.');
    }
    this.assertOwner(reserva, clienteId);
    await this.cache.set(reserva);
    return reserva;
  }

  public async actualizar(
    id: string,
    input: ActualizarReserva,
    clienteId?: string,
  ): Promise<Reserva> {
    return measured('update', () =>
      conReservaExclusiva(this.repository, id, () =>
        this.withDistributedLock(`lock:reserva:${id}:activacion`, async () => {
          await this.cache.invalidate(id);
          const result = await this.actualizarExclusiva(id, input, clienteId);
          await this.cache.set(result);
          return result;
        }),
      ),
    );
  }

  private async actualizarExclusiva(
    id: string,
    input: ActualizarReserva,
    clienteId?: string,
  ): Promise<Reserva> {
    const actual = await this.obtenerPorIdInterno(id, clienteId);
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

    let degradation: DegradationCause | null = null;
    if (requiereNuevaTarifa) {
      let route = cambiaRecorrido ? null : actual.routeSnapshot;
      let stage: 'route' | 'fare' = 'route';
      try {
        route ??= await this.routeResolver.resolve(origen, destino);
        stage = 'fare';
        const fare = await this.tarifaClient.estimar({ vehiculo, route });
        cambios.routeSnapshot = route;
        cambios.tarifaEstimada = fare.tarifaEstimada;
        cambios.moneda = fare.moneda;
        cambios.estimacionTarifaId = fare.estimacionId;
      } catch (error) {
        degradation = degradationCause(stage, error);
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
    if (degradation !== null) recordPricingDegradation('update', degradation);
    return actualizada;
  }

  public async cancelar(id: string, clienteId?: string): Promise<Reserva> {
    return measured('cancel', () =>
      conReservaExclusiva(this.repository, id, () =>
        this.withDistributedLock(`lock:reserva:${id}:activacion`, async () => {
          await this.cache.invalidate(id);
          const result = await this.cancelarExclusiva(id, clienteId);
          await this.cache.set(result);
          return result;
        }),
      ),
    );
  }

  private async cancelarExclusiva(id: string, clienteId?: string): Promise<Reserva> {
    const actual = await this.obtenerPorIdInterno(id, clienteId);
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
      await this.dispatchClient.cancelRequest(
        actual.idSolicitud,
        'Reserva cancelada en M9',
        actual.clienteId,
      );
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
  ): Promise<PricingResult> {
    let route: RouteSnapshot;
    try {
      route = await this.routeResolver.resolve(origin, destination);
    } catch (error) {
      // Política de degradación existente: la reserva puede guardarse sin tarifa.
      return { pricing: null, cause: degradationCause('route', error) };
    }
    try {
      const fare = await this.tarifaClient.estimar({ vehiculo, route });
      return { pricing: { route, fare }, cause: null };
    } catch (error) {
      return { pricing: null, cause: degradationCause('fare', error) };
    }
  }

  private async withDistributedLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    return this.distributedLock === undefined
      ? action()
      : this.distributedLock.runExclusive(key, action);
  }

  private assertOwner(reserva: Reserva, clienteId?: string): void {
    if (clienteId !== undefined && reserva.clienteId !== clienteId)
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'La reserva no existe.');
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
