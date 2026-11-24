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
  listarPaginado(page?: number, pageSize?: number, clienteId?: string): Promise<Reserva[]>;
  actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null>;
  cancelar(id: string, estadoEsperado: EstadoReserva): Promise<Reserva | null>;
  recuperarActivacion(id: string, anteriorA: Date): Promise<boolean>;
  buscarPendientes(fechaLimite: Date, limite?: number, clienteId?: string): Promise<Reserva[]>;
  cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio?: CambioEstadoReserva,
  ): Promise<Reserva | null>;
}
