import crypto from 'node:crypto';

// Definimos los posibles estados de un ticket de soporte
export type TicketStatus = 'ABIERTO' | 'EN_PROCESO' | 'RESUELTO';

// Interfaz que define cómo luce un Ticket
export interface Ticket {
  id: string;
  viajeId: string;
  motivo: string;
  estado: TicketStatus;
  fechaCreacion: string;
}

// Repositorio en memoria (simula una base de datos)
class TicketRepository {
  private tickets: Ticket[] = [];

  // Método para crear un nuevo ticket
  crear(viajeId: string, motivo: string): Ticket {
    const nuevoTicket: Ticket = {
      id: crypto.randomUUID(), // Genera un ID único al azar
      viajeId,
      motivo,
      estado: 'ABIERTO',
      fechaCreacion: new Date().toISOString()
    };
    
    this.tickets.push(nuevoTicket);
    return nuevoTicket;
  }

  // Método para buscar un ticket por su ID
  obtenerPorId(id: string): Ticket | undefined {
    return this.tickets.find(ticket => ticket.id === id);
  }

  // Método para actualizar el estado de un ticket
  actualizarEstado(id: string, nuevoEstado: TicketStatus): Ticket | null {
    const ticket = this.obtenerPorId(id);
    if (!ticket) {
      return null;
    }
    ticket.estado = nuevoEstado;
    return ticket;
  }

  // Listar todos los tickets (útil para pruebas)
  listarTodos(): Ticket[] {
    return this.tickets;
  }
}

// Exportamos una única instancia (Singleton) para que toda la app comparta los mismos datos
export const ticketRepository = new TicketRepository();
