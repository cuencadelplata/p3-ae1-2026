import type { Ticket, TicketStatus } from '../models/ticket.model.js';
import type { TicketRepository } from '../repositories/ticket.repository.js';

// Casos de uso de tickets (RF-8.5). No conoce Express ni el motor de
// persistencia: recibe el repositorio por constructor.
export class TicketService {
  constructor(private readonly repository: TicketRepository) {}

  crearTicket(viajeId: string, motivo: string): Promise<Ticket> {
    return this.repository.crear(viajeId, motivo);
  }

  obtenerTicket(id: string): Promise<Ticket | undefined> {
    return this.repository.obtenerPorId(id);
  }

  actualizarEstado(id: string, nuevoEstado: TicketStatus): Promise<Ticket | null> {
    return this.repository.actualizarEstado(id, nuevoEstado);
  }

  listarTickets(): Promise<Ticket[]> {
    return this.repository.listarTodos();
  }
}
