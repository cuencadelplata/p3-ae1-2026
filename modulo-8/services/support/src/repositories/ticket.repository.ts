import type { Ticket, TicketHistoryEntry, TicketStatus } from '../models/ticket.model.js';

export interface OpcionesDeCreacion {
  // Quién crea el ticket (string opaco), si se conoce.
  actor?: string | null;
}

export interface CambioDeEstado {
  // Quién cambia el estado (string opaco), si se conoce.
  actor?: string | null;
  motivo?: string | null;
  // Si se indica, el cambio sólo se aplica cuando el ticket sigue en esa
  // versión (equivale a UPDATE ... WHERE version = $2).
  expectedVersion?: number;
}

// El ticket existe pero ya no está en la versión esperada.
export class TicketVersionConflictError extends Error {
  constructor() {
    super('La versión del ticket no coincide con la esperada.');
    this.name = 'TicketVersionConflictError';
  }
}

// Contrato de persistencia de tickets. Es asíncrono para admitir una base de
// datos; hoy lo implementa el repositorio en memoria.
//
// crear y actualizarEstado escriben el ticket y su entrada de historial como
// una sola operación: nunca queda uno sin el otro. actualizarEstado compara la
// versión y escribe de forma atómica; si no coincide lanza
// TicketVersionConflictError, y devuelve null si el ticket no existe.
export interface TicketRepository {
  crear(tripId: string, motivo: string, opciones?: OpcionesDeCreacion): Promise<Ticket>;
  obtenerPorId(id: string): Promise<Ticket | undefined>;
  actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio?: CambioDeEstado): Promise<Ticket | null>;
  // Historial del ticket en orden cronológico.
  listarHistorial(ticketId: string): Promise<TicketHistoryEntry[]>;
  listarTodos(): Promise<Ticket[]>;
}
