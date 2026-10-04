import type { Ticket, TicketHistoryEntry, TicketStatus } from '../models/ticket.model.js';

export interface OpcionesDeCreacion {
  // Quién crea el ticket (string opaco), si se conoce.
  actor?: string | null;
}

export interface CambioDeEstado {
  // Quién cambia el estado (string opaco), si se conoce.
  actor?: string | null;
  motivo?: string | null;
}

// Contrato de persistencia de tickets. Es asíncrono para admitir una base de
// datos; hoy lo implementa el repositorio en memoria.
//
// crear y actualizarEstado escriben el ticket y su entrada de historial como
// una sola operación: nunca queda uno sin el otro.
export interface TicketRepository {
  crear(tripId: string, motivo: string, opciones?: OpcionesDeCreacion): Promise<Ticket>;
  obtenerPorId(id: string): Promise<Ticket | undefined>;
  actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio?: CambioDeEstado): Promise<Ticket | null>;
  // Historial del ticket en orden cronológico.
  listarHistorial(ticketId: string): Promise<TicketHistoryEntry[]>;
  listarTodos(): Promise<Ticket[]>;
}
