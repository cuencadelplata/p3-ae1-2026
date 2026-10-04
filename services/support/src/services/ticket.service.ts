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

  obtenerTicket(id: string): Promise<Ticket | undefined> {
    return this.repository.obtenerPorId(id);
  }

  async actualizarEstado(id: string, nuevoEstado: TicketStatus): Promise<Ticket | null> {
    const ticketActualizado = await this.repository.actualizarEstado(id, nuevoEstado);
    if (ticketActualizado) {
      await this.eventPublisher.publish('ticket.actualizado', ticketActualizado);
    }
    return ticketActualizado;
  }

  listarTickets(): Promise<Ticket[]> {
    return this.repository.listarTodos();
  }
}
