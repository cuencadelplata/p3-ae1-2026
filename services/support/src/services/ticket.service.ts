import { createHash } from 'node:crypto';
import {
  concurrencyConflict,
  idempotencyConflict,
  invalidTransition,
  ticketNotFound,
  validationError,
} from '../errors/support-error.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import { TRANSICIONES_PERMITIDAS } from '../models/ticket.model.js';
import type { Ticket, TicketHistoryEntry, TicketStatus } from '../models/ticket.model.js';
import { IdempotencyKeyConflictError, TicketVersionConflictError } from '../repositories/ticket.repository.js';
import type {
  CambioDeEstado,
  OpcionesDeCreacion,
  PosicionDeListado,
  TicketRepository,
} from '../repositories/ticket.repository.js';

export interface OpcionesDeNuevoTicket extends OpcionesDeCreacion {
  // Si se indica, repetir el pedido con la misma clave no crea otro ticket.
  idempotencyKey?: string;
}

export interface ConsultaDeTickets {
  tripId?: string;
  estado?: TicketStatus;
  limit?: number;
  cursor?: string;
}

const LIMITE_POR_DEFECTO = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El cursor es opaco para el cliente: codifica la posición del último ticket
// de la página.
function codificarCursor({ fechaCreacion, id }: PosicionDeListado): string {
  return Buffer.from(JSON.stringify([fechaCreacion, id])).toString('base64url');
}

function decodificarCursor(cursor: string): PosicionDeListado {
  try {
    const [fechaCreacion, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof fechaCreacion === 'string' && typeof id === 'string' && UUID.test(id) && !Number.isNaN(Date.parse(fechaCreacion))) {
      return { fechaCreacion, id };
    }
  } catch {
    // Se informa abajo como cursor inválido.
  }
  throw validationError([{ field: 'cursor', reason: 'No es un cursor válido.' }]);
}

// Huella del pedido ya normalizado, con las claves ordenadas: no depende de si
// el cliente envió tripId o viajeId ni del orden de los campos.
function huellaDelPedido(pedido: Record<string, string>): string {
  const ordenado = Object.keys(pedido)
    .sort()
    .map((clave) => [clave, pedido[clave]]);
  return createHash('sha256').update(JSON.stringify(ordenado)).digest('hex');
}

// Casos de uso de tickets (RF-8.5). No conoce Express, el motor de
// persistencia ni el broker: recibe sus dependencias por constructor.
export class TicketService {
  constructor(
    private readonly repository: TicketRepository,
    private readonly eventPublisher: SupportEventPublisher,
  ) {}

  async crearTicket(
    tripId: string,
    motivo: string,
    { idempotencyKey, ...opciones }: OpcionesDeNuevoTicket = {},
  ): Promise<{ ticket: Ticket; creado: boolean }> {
    const resultado = idempotencyKey === undefined
      ? { ticket: await this.repository.crear(tripId, motivo, opciones), creado: true }
      : await this.crearUnaSolaVez(tripId, motivo, idempotencyKey, opciones);

    // Un reintento devuelve el ticket existente sin volver a publicar.
    if (resultado.creado) {
      await this.eventPublisher.publish('ticket.creado', resultado.ticket);
    }
    return resultado;
  }

  private async crearUnaSolaVez(tripId: string, motivo: string, clave: string, opciones: OpcionesDeCreacion) {
    try {
      const hash = huellaDelPedido({ tripId, motivo });
      return await this.repository.crearConClave(tripId, motivo, { clave, hash }, opciones);
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw idempotencyConflict();
      }
      throw error;
    }
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

    // El cliente decidió sobre una versión que ya no es la actual.
    if (cambio.expectedVersion !== undefined && cambio.expectedVersion !== ticket.version) {
      throw concurrencyConflict();
    }

    // Mismo estado: operación sin efecto. No deja historial, no sube la
    // versión ni publica evento, así un cliente puede reintentar el pedido
    // sin duplicar nada.
    if (ticket.estado === nuevoEstado) {
      return ticket;
    }

    if (!TRANSICIONES_PERMITIDAS[ticket.estado].includes(nuevoEstado)) {
      throw invalidTransition(ticket.estado, nuevoEstado);
    }
    if (ticket.estado === 'RESUELTO' && nuevoEstado === 'ABIERTO' && !cambio.motivo) {
      throw validationError([{ field: 'motivo', reason: 'Reabrir un ticket resuelto requiere un motivo.' }]);
    }

    // El cambio se condiciona siempre a la versión recién leída, también para
    // los clientes que no envían expectedVersion: dos cambios simultáneos no
    // pueden aplicarse ambos.
    const ticketActualizado = await this.cambiarEstadoSiSigueEn(ticket, nuevoEstado, cambio);
    if (!ticketActualizado) {
      throw ticketNotFound();
    }
    await this.eventPublisher.publish('ticket.actualizado', ticketActualizado);
    return ticketActualizado;
  }

  private async cambiarEstadoSiSigueEn(ticket: Ticket, nuevoEstado: TicketStatus, cambio: CambioDeEstado) {
    try {
      return await this.repository.actualizarEstado(ticket.id, nuevoEstado, {
        ...cambio,
        expectedVersion: ticket.version,
      });
    } catch (error) {
      if (error instanceof TicketVersionConflictError) {
        throw concurrencyConflict();
      }
      throw error;
    }
  }

  async obtenerHistorial(id: string): Promise<TicketHistoryEntry[]> {
    await this.obtenerTicket(id);
    return this.repository.listarHistorial(id);
  }

  async listarTickets(consulta: ConsultaDeTickets = {}): Promise<{ tickets: Ticket[]; siguienteCursor?: string }> {
    const limit = consulta.limit ?? LIMITE_POR_DEFECTO;
    const despuesDe = consulta.cursor === undefined ? undefined : decodificarCursor(consulta.cursor);

    // Se pide uno de más para saber si hay otra página.
    const encontrados = await this.repository.listar({
      tripId: consulta.tripId,
      estado: consulta.estado,
      limit: limit + 1,
      despuesDe,
    });
    if (encontrados.length <= limit) {
      return { tickets: encontrados };
    }

    const tickets = encontrados.slice(0, limit);
    return { tickets, siguienteCursor: codificarCursor(tickets[tickets.length - 1]) };
  }
}
