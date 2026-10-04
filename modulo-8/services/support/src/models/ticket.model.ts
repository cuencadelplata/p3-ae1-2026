import crypto from 'node:crypto';
import type { CambioDeEstado, OpcionesDeCreacion, TicketRepository } from '../repositories/ticket.repository.js';

// Definimos los posibles estados de un ticket de soporte
export type TicketStatus = 'ABIERTO' | 'EN_PROCESO' | 'RESUELTO';

// Transiciones de estado permitidas. Pasar al mismo estado no es una
// transición: se trata como una operación sin efecto.
export const TRANSICIONES_PERMITIDAS: Record<TicketStatus, readonly TicketStatus[]> = {
  ABIERTO: ['EN_PROCESO', 'RESUELTO'],
  EN_PROCESO: ['ABIERTO', 'RESUELTO'],
  RESUELTO: ['ABIERTO'],
};

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

// Cambio de estado registrado en el historial de un ticket.
export interface TicketHistoryEntry {
  id: number;
  ticketId: string;
  // null en la entrada inicial, creada junto con el ticket.
  estadoAnterior: TicketStatus | null;
  estadoNuevo: TicketStatus;
  cambiadoPor: string | null;
  motivo: string | null;
  fecha: string;
}

// Repositorio en memoria (simula una base de datos)
export class InMemoryTicketRepository implements TicketRepository {
  private tickets: Ticket[] = [];
  private historial: TicketHistoryEntry[] = [];

  // Método para crear un nuevo ticket
  async crear(tripId: string, motivo: string, opciones: OpcionesDeCreacion = {}): Promise<Ticket> {
    const nuevoTicket: Ticket = {
      id: crypto.randomUUID(), // Genera un ID único al azar
      tripId,
      viajeId: tripId,
      motivo,
      estado: 'ABIERTO',
      fechaCreacion: new Date().toISOString()
    };

    this.tickets.push(nuevoTicket);
    this.registrarCambio(nuevoTicket.id, null, nuevoTicket.estado, opciones.actor, null, nuevoTicket.fechaCreacion);
    return { ...nuevoTicket };
  }

  // Método para buscar un ticket por su ID
  async obtenerPorId(id: string): Promise<Ticket | undefined> {
    const ticket = this.tickets.find(ticket => ticket.id === id);
    return ticket && { ...ticket };
  }

  // Método para actualizar el estado de un ticket
  async actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio: CambioDeEstado = {}): Promise<Ticket | null> {
    const ticket = this.tickets.find(ticket => ticket.id === id);
    if (!ticket) {
      return null;
    }
    const estadoAnterior = ticket.estado;
    ticket.estado = nuevoEstado;
    this.registrarCambio(id, estadoAnterior, nuevoEstado, cambio.actor, cambio.motivo, new Date().toISOString());
    return { ...ticket };
  }

  async listarHistorial(ticketId: string): Promise<TicketHistoryEntry[]> {
    return this.historial.filter(entrada => entrada.ticketId === ticketId).map(entrada => ({ ...entrada }));
  }

  // Listar todos los tickets (útil para pruebas)
  async listarTodos(): Promise<Ticket[]> {
    return this.tickets.map(ticket => ({ ...ticket }));
  }

  private registrarCambio(
    ticketId: string,
    estadoAnterior: TicketStatus | null,
    estadoNuevo: TicketStatus,
    actor: string | null | undefined,
    motivo: string | null | undefined,
    fecha: string,
  ) {
    this.historial.push({
      id: this.historial.length + 1,
      ticketId,
      estadoAnterior,
      estadoNuevo,
      cambiadoPor: actor ?? null,
      motivo: motivo ?? null,
      fecha,
    });
  }
}

// Exportamos una única instancia (Singleton) para que toda la app comparta los mismos datos
export const ticketRepository = new InMemoryTicketRepository();
