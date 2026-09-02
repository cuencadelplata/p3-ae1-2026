import type {
  CambiosReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
} from '../domain/reserva.js';

export interface ReservaRepository {
  crear(input: CrearReserva): Promise<Reserva>;
  obtenerPorId(id: string): Promise<Reserva | null>;
  listar(): Promise<Reserva[]>;
  actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null>;
  cancelarProgramada(id: string): Promise<Reserva | null>;
  buscarPendientes(fechaLimite: Date, limite?: number): Promise<Reserva[]>;
  cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio?: CambioEstadoReserva,
  ): Promise<Reserva | null>;
}
