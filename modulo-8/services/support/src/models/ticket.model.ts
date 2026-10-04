import crypto from 'node:crypto';
import { TicketVersionConflictError } from '../repositories/ticket.repository.js';
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
  // Empieza en 1 y sube en cada cambio de estado (control optimista).
  version: number;
  fechaCreacion: string;
  fechaActualizacion: string;
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
    const ahora = new Date().toISOString();
    const nuevoTicket: Ticket = {
      id: crypto.randomUUID(), // Genera un ID único al azar
      tripId,
      viajeId: tripId,
      motivo,
      estado: 'ABIERTO',
      version: 1,
      fechaCreacion: ahora,
      fechaActualizacion: ahora
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

  // Método para actualizar el estado de un ticket. La comparación de versión
  // y la escritura ocurren sin ningún await en el medio: son atómicas.
  async actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio: CambioDeEstado = {}): Promise<Ticket | null> {
    const ticket = this.tickets.find(ticket => ticket.id === id);
    if (!ticket) {
      return null;
    }
    if (cambio.expectedVersion !== undefined && cambio.expectedVersion !== ticket.version) {
      throw new TicketVersionConflictError();
    }
    const estadoAnterior = ticket.estado;
    const ahora = new Date().toISOString();
    ticket.estado = nuevoEstado;
    ticket.version += 1;
    ticket.fechaActualizacion = ahora;
    this.registrarCambio(id, estadoAnterior, nuevoEstado, cambio.actor, cambio.motivo, ahora);
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
