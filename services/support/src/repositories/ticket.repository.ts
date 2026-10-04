import type { Ticket, TicketStatus } from '../models/ticket.model.js';

// Contrato de persistencia de tickets. Es asíncrono para admitir una base de
// datos; hoy lo implementa el repositorio en memoria.
export interface TicketRepository {
  crear(viajeId: string, motivo: string): Promise<Ticket>;
  obtenerPorId(id: string): Promise<Ticket | undefined>;
  actualizarEstado(id: string, nuevoEstado: TicketStatus): Promise<Ticket | null>;
  listarTodos(): Promise<Ticket[]>;
}
