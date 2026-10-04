import { NOOP_RESERVATION_CACHE, type ReservationCache } from '../cache/reservation-cache.js';
import type { DispatchClient, M5RideRequest } from '../clients/m5-dispatch.client.js';
import type { Reserva } from '../domain/reserva.js';
import type { RouteResolver } from '../integration/route-estimate.port.js';
import type { DistributedLock } from '../locks/distributed-lock.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';
import { conReservaExclusiva } from './reserva-lock.js';

export interface ResultadoActivacion {
  reservaId: string;
  activada: boolean;
  fallida: boolean;
}

export type DispatchMode = 'rest' | 'events';

export class ActivacionReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly dispatchClient: DispatchClient,
    private readonly routeResolver: RouteResolver,
    private readonly cache: ReservationCache = NOOP_RESERVATION_CACHE,
    private readonly distributedLock?: DistributedLock,
    private readonly dispatchMode: DispatchMode = 'rest',
  ) {}

  public async activar(reservaId: string): Promise<ResultadoActivacion> {
    return conReservaExclusiva(this.repository, reservaId, () =>
      this.withDistributedLock(`lock:reserva:${reservaId}:activacion`, async () => {
        await this.cache.invalidate(reservaId);
        return this.activarExclusiva(reservaId);
      }),
    );
  }

  private async withDistributedLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    return this.distributedLock === undefined
      ? action()
      : this.distributedLock.runExclusive(key, action);
  }

  private async activarExclusiva(reservaId: string): Promise<ResultadoActivacion> {
    const actual = await this.repository.obtenerPorId(reservaId);
    if (actual === null) return this.resultado(reservaId);

    if (actual.estado === 'ACTIVANDO' && actual.idSolicitud !== null) {
      const request = await this.dispatchClient.getRequest(actual.idSolicitud);
      return this.aplicarEstadoM5(actual, request);
    }

    if (actual.estado !== 'PROGRAMADA' || Date.parse(actual.fechaHoraProgramada) > Date.now()) {
      return this.resultado(reservaId);
    }

    let route = actual.routeSnapshot;
    try {
      route ??= await this.routeResolver.resolve(actual.origen, actual.destino);
    } catch {
      const fallida = await this.repository.cambiarEstado(reservaId, 'PROGRAMADA', 'FALLIDA');
      if (fallida !== null) await this.cache.set(fallida);
      return this.resultado(reservaId, false, fallida !== null);
    }

    const reclamada = await this.repository.cambiarEstado(reservaId, 'PROGRAMADA', 'ACTIVANDO', {
      routeSnapshot: route,
    });
    if (reclamada === null) return this.resultado(reservaId);

    if (this.dispatchMode === 'events') {
      await this.cache.set(reclamada);
      return this.resultado(reservaId);
    }

    try {
      const request = await this.dispatchClient.createRequest({
        reserva: reclamada,
        origin: route.origin,
        destination: route.destination,
      });
      const conSolicitud = await this.repository.cambiarEstado(
        reservaId,
        'ACTIVANDO',
        'ACTIVANDO',
        { idSolicitud: request.requestId },
      );
      if (conSolicitud === null) return this.resultado(reservaId);
      return this.aplicarEstadoM5(conSolicitud, request);
    } catch (error) {
      // Sin confirmación de M5 no se inventa un fallo de negocio: se vuelve a PROGRAMADA
      // para que el scheduler reintente con la misma Idempotency-Key.
      const reprogramada = await this.repository.cambiarEstado(
        reservaId,
        'ACTIVANDO',
        'PROGRAMADA',
      );
      if (reprogramada !== null) await this.cache.set(reprogramada);
      throw error;
    }
  }

  private async aplicarEstadoM5(
    reserva: Reserva,
    request: M5RideRequest,
  ): Promise<ResultadoActivacion> {
    if (request.status === 'ASSIGNED') {
      if (request.assignedDriverId === null) {
        const fallida = await this.repository.cambiarEstado(reserva.id, 'ACTIVANDO', 'FALLIDA');
        if (fallida !== null) await this.cache.set(fallida);
        return this.resultado(reserva.id, false, fallida !== null);
      }
      const activada = await this.repository.cambiarEstado(reserva.id, 'ACTIVANDO', 'ACTIVADA', {
        idSolicitud: request.requestId,
        assignedDriverId: request.assignedDriverId,
      });
      if (activada !== null) await this.cache.set(activada);
      return this.resultado(reserva.id, activada !== null);
    }

    if (request.status === 'EXPIRED' || request.status === 'NO_DRIVERS_AVAILABLE') {
      const fallida = await this.repository.cambiarEstado(reserva.id, 'ACTIVANDO', 'FALLIDA', {
        idSolicitud: request.requestId,
      });
      if (fallida !== null) await this.cache.set(fallida);
      return this.resultado(reserva.id, false, fallida !== null);
    }

    if (request.status === 'CANCELLED') {
      const cancelada = await this.repository.cambiarEstado(reserva.id, 'ACTIVANDO', 'CANCELADA', {
        idSolicitud: request.requestId,
      });
      if (cancelada !== null) await this.cache.set(cancelada);
      return this.resultado(reserva.id);
    }

    await this.cache.set(reserva);
    return this.resultado(reserva.id);
  }

  private resultado(reservaId: string, activada = false, fallida = false): ResultadoActivacion {
    return { reservaId, activada, fallida };
  }
}
