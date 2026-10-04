import { randomUUID } from 'node:crypto';

import type {
  CambiosReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
} from '../domain/reserva.js';
import type { ReservaRepository } from './reserva.repository.js';

const clone = (reserva: Reserva): Reserva => ({
  ...reserva,
  routeSnapshot:
    reserva.routeSnapshot === null
      ? null
      : {
          ...reserva.routeSnapshot,
          origin: { ...reserva.routeSnapshot.origin },
          destination: { ...reserva.routeSnapshot.destination },
        },
});

export class InMemoryReservaRepository implements ReservaRepository {
  private readonly reservas = new Map<string, Reserva>();

  public async crear(input: CrearReserva): Promise<Reserva> {
    const now = new Date().toISOString();
    const reserva: Reserva = {
      id: randomUUID(),
      clienteId: input.clienteId,
      origen: input.origen,
      destino: input.destino,
      vehiculo: input.vehiculo,
      fechaHoraProgramada: input.fechaHoraProgramada,
      estado: 'PROGRAMADA',
      tarifaEstimada: input.tarifaEstimada ?? null,
      moneda: input.moneda ?? 'ARS',
      estimacionTarifaId: input.estimacionTarifaId ?? null,
      routeSnapshot: input.routeSnapshot ?? null,
      criterioAsignacion: null,
      idSolicitud: null,
      assignedDriverId: null,
      creadoEn: now,
      actualizadoEn: now,
    };

    this.reservas.set(reserva.id, reserva);
    return clone(reserva);
  }

  public async obtenerPorId(id: string): Promise<Reserva | null> {
    const reserva = this.reservas.get(id);
    return reserva === undefined ? null : clone(reserva);
  }

  public async listar(): Promise<Reserva[]> {
    return [...this.reservas.values()]
      .sort((a, b) => Date.parse(a.fechaHoraProgramada) - Date.parse(b.fechaHoraProgramada))
      .map(clone);
  }

  public async actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null> {
    const reserva = this.reservas.get(id);
    if (reserva === undefined || reserva.estado !== 'PROGRAMADA') return null;

    Object.assign(reserva, input, { actualizadoEn: new Date().toISOString() });
    return clone(reserva);
  }

  public async cancelar(id: string, estadoEsperado: EstadoReserva): Promise<Reserva | null> {
    const reserva = this.reservas.get(id);
    if (reserva === undefined || reserva.estado !== estadoEsperado) return null;
    reserva.estado = 'CANCELADA';
    reserva.actualizadoEn = new Date().toISOString();
    return clone(reserva);
  }

  public async buscarPendientes(fechaLimite: Date, limite = 100): Promise<Reserva[]> {
    return [...this.reservas.values()]
      .filter(
        (reserva) =>
          (reserva.estado === 'ACTIVANDO' && reserva.idSolicitud !== null) ||
          (reserva.estado === 'PROGRAMADA' &&
            Date.parse(reserva.fechaHoraProgramada) <= fechaLimite.getTime()),
      )
      .sort((a, b) => Date.parse(a.fechaHoraProgramada) - Date.parse(b.fechaHoraProgramada))
      .slice(0, limite)
      .map(clone);
  }

  public async cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio: CambioEstadoReserva = {},
  ): Promise<Reserva | null> {
    const reserva = this.reservas.get(id);
    if (reserva === undefined || reserva.estado !== estadoEsperado) return null;

    reserva.estado = nuevoEstado;
    reserva.actualizadoEn = new Date().toISOString();
    if (cambio.idSolicitud !== undefined) reserva.idSolicitud = cambio.idSolicitud;
    if (cambio.assignedDriverId !== undefined) reserva.assignedDriverId = cambio.assignedDriverId;
    if (cambio.routeSnapshot !== undefined) reserva.routeSnapshot = cambio.routeSnapshot;
    return clone(reserva);
  }
}
