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

// Posición de un ticket en el listado: su fecha de creación y su id.
export interface PosicionDeListado {
  fechaCreacion: string;
  id: string;
}

export interface FiltroDeTickets {
  tripId?: string;
  estado?: TicketStatus;
  limit: number;
  // Devuelve sólo los tickets posteriores a esta posición en el orden del listado.
  despuesDe?: PosicionDeListado;
}

export interface ClaveDeIdempotencia {
  clave: string;
  // Huella del pedido normalizado: distingue un reintento de un pedido distinto.
  hash: string;
}

// La clave ya está asociada a un pedido con otra huella.
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super('La clave de idempotencia ya se usó con un pedido distinto.');
    this.name = 'IdempotencyKeyConflictError';
  }
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
//
// crearConClave crea a lo sumo un ticket por clave, también ante pedidos
// simultáneos: si la clave ya existe con la misma huella devuelve ese ticket
// con creado: false, y con otra huella lanza IdempotencyKeyConflictError.
export interface TicketRepository {
  crear(tripId: string, motivo: string, opciones?: OpcionesDeCreacion): Promise<Ticket>;
  crearConClave(
    tripId: string,
    motivo: string,
    idempotencia: ClaveDeIdempotencia,
    opciones?: OpcionesDeCreacion,
  ): Promise<{ ticket: Ticket; creado: boolean }>;
  obtenerPorId(id: string): Promise<Ticket | undefined>;
  actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio?: CambioDeEstado): Promise<Ticket | null>;
  // Historial del ticket en orden cronológico.
  listarHistorial(ticketId: string): Promise<TicketHistoryEntry[]>;
  // Orden estable: fecha de creación descendente y luego id descendente.
  listar(filtro: FiltroDeTickets): Promise<Ticket[]>;
}
