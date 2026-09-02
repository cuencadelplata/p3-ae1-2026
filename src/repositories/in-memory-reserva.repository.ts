import { randomUUID } from 'node:crypto';

import type {
  ActualizarReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
} from '../domain/reserva.js';
import type { ReservaRepository } from './reserva.repository.js';

const clone = (reserva: Reserva): Reserva => ({ ...reserva });

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
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
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
      .sort((a, b) => a.fechaHoraProgramada.localeCompare(b.fechaHoraProgramada))
      .map(clone);
  }

  public async actualizarProgramada(
    id: string,
    input: ActualizarReserva,
  ): Promise<Reserva | null> {
    const reserva = this.reservas.get(id);
    if (reserva === undefined || reserva.estado !== 'PROGRAMADA') return null;

    Object.assign(reserva, input, { actualizadoEn: new Date().toISOString() });
    return clone(reserva);
  }

  public async cancelarProgramada(id: string): Promise<Reserva | null> {
    return this.cambiarEstado(id, 'PROGRAMADA', 'CANCELADA');
  }

  public async buscarPendientes(fechaLimite: Date, limite = 100): Promise<Reserva[]> {
    return [...this.reservas.values()]
      .filter(
        (reserva) =>
          reserva.estado === 'PROGRAMADA' &&
          Date.parse(reserva.fechaHoraProgramada) <= fechaLimite.getTime(),
      )
      .sort((a, b) => a.fechaHoraProgramada.localeCompare(b.fechaHoraProgramada))
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
    return clone(reserva);
  }
}
