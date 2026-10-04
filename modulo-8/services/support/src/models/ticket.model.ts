import crypto from 'node:crypto';
import type { TicketRepository } from '../repositories/ticket.repository.js';

// Definimos los posibles estados de un ticket de soporte
export type TicketStatus = 'ABIERTO' | 'EN_PROCESO' | 'RESUELTO';

// Interfaz que define cómo luce un Ticket
export interface Ticket {
  id: string;
  // Identificador del viaje: string opaco definido por otro módulo.
  tripId: string;
  // Alias deprecado de tripId; se mantiene mientras dure la transición.
  viajeId: string;
  motivo: string;
  estado: TicketStatus;
  fechaCreacion: string;
}

// Repositorio en memoria (simula una base de datos)
export class InMemoryTicketRepository implements TicketRepository {
  private tickets: Ticket[] = [];

  // Método para crear un nuevo ticket
  async crear(tripId: string, motivo: string): Promise<Ticket> {
    const nuevoTicket: Ticket = {
      id: crypto.randomUUID(), // Genera un ID único al azar
      tripId,
      viajeId: tripId,
      motivo,
      estado: 'ABIERTO',
      fechaCreacion: new Date().toISOString()
    };

    this.tickets.push(nuevoTicket);
    return nuevoTicket;
  }

  // Método para buscar un ticket por su ID
  async obtenerPorId(id: string): Promise<Ticket | undefined> {
    return this.tickets.find(ticket => ticket.id === id);
  }

  // Método para actualizar el estado de un ticket
  async actualizarEstado(id: string, nuevoEstado: TicketStatus): Promise<Ticket | null> {
    const ticket = await this.obtenerPorId(id);
    if (!ticket) {
      return null;
    }
    ticket.estado = nuevoEstado;
    return ticket;
  }

  // Listar todos los tickets (útil para pruebas)
  async listarTodos(): Promise<Ticket[]> {
    return this.tickets;
  }
}

// Exportamos una única instancia (Singleton) para que toda la app comparta los mismos datos
export const ticketRepository = new InMemoryTicketRepository();
