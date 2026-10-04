import { invalidTransition, ticketNotFound, validationError } from '../errors/support-error.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import { TRANSICIONES_PERMITIDAS } from '../models/ticket.model.js';
import type { Ticket, TicketHistoryEntry, TicketStatus } from '../models/ticket.model.js';
import type { CambioDeEstado, OpcionesDeCreacion, TicketRepository } from '../repositories/ticket.repository.js';

// Casos de uso de tickets (RF-8.5). No conoce Express, el motor de
// persistencia ni el broker: recibe sus dependencias por constructor.
export class TicketService {
  constructor(
    private readonly repository: TicketRepository,
    private readonly eventPublisher: SupportEventPublisher,
  ) {}

  async crearTicket(tripId: string, motivo: string, opciones: OpcionesDeCreacion = {}): Promise<Ticket> {
    const nuevoTicket = await this.repository.crear(tripId, motivo, opciones);
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

  async actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio: CambioDeEstado = {}): Promise<Ticket> {
    const ticket = await this.obtenerTicket(id);

    // Mismo estado: operación sin efecto. No deja historial ni publica evento,
    // así un cliente puede reintentar el pedido sin duplicar nada.
    if (ticket.estado === nuevoEstado) {
      return ticket;
    }

    if (!TRANSICIONES_PERMITIDAS[ticket.estado].includes(nuevoEstado)) {
      throw invalidTransition(ticket.estado, nuevoEstado);
    }
    if (ticket.estado === 'RESUELTO' && nuevoEstado === 'ABIERTO' && !cambio.motivo) {
      throw validationError([{ field: 'motivo', reason: 'Reabrir un ticket resuelto requiere un motivo.' }]);
    }

    const ticketActualizado = await this.repository.actualizarEstado(id, nuevoEstado, cambio);
    if (!ticketActualizado) {
      throw ticketNotFound();
    }
    await this.eventPublisher.publish('ticket.actualizado', ticketActualizado);
    return ticketActualizado;
  }

  async obtenerHistorial(id: string): Promise<TicketHistoryEntry[]> {
    await this.obtenerTicket(id);
    return this.repository.listarHistorial(id);
  }

  listarTickets(): Promise<Ticket[]> {
    return this.repository.listarTodos();
  }
}
