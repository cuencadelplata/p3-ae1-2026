import { ticketNotFound } from '../errors/support-error.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import type { Ticket, TicketStatus } from '../models/ticket.model.js';
import type { TicketRepository } from '../repositories/ticket.repository.js';

// Casos de uso de tickets (RF-8.5). No conoce Express, el motor de
// persistencia ni el broker: recibe sus dependencias por constructor.
export class TicketService {
  constructor(
    private readonly repository: TicketRepository,
    private readonly eventPublisher: SupportEventPublisher,
  ) {}

  async crearTicket(tripId: string, motivo: string): Promise<Ticket> {
    const nuevoTicket = await this.repository.crear(tripId, motivo);
    await this.eventPublisher.publish('ticket.creado', nuevoTicket);
    return nuevoTicket;
  }

  async obtenerTicket(id: string): Promise<Ticket> {
    const ticket = await this.repository.obtenerPorId(id);
    if (!ticket) {
      throw ticketNotFound();
    }
    return ticket;
  }

  async actualizarEstado(id: string, nuevoEstado: TicketStatus): Promise<Ticket> {
    const ticketActualizado = await this.repository.actualizarEstado(id, nuevoEstado);
    if (!ticketActualizado) {
      throw ticketNotFound();
    }
    await this.eventPublisher.publish('ticket.actualizado', ticketActualizado);
    return ticketActualizado;
  }

  listarTickets(): Promise<Ticket[]> {
    return this.repository.listarTodos();
  }
}
