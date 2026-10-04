import { validationError, type ErrorDetail } from '../errors/support-error.js';
import type { TicketStatus } from '../models/ticket.model.js';

const ESTADOS_VALIDOS: TicketStatus[] = ['ABIERTO', 'EN_PROCESO', 'RESUELTO'];

function esTextoNoVacio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== '';
}

function comoObjeto(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

// tripId identifica el viaje; viajeId se acepta como alias deprecado. Son
// strings opacos: un número u objeto no se convierte, se rechaza.
function validarTripId(tripId: unknown, viajeId: unknown): ErrorDetail[] {
  if (tripId === undefined && viajeId === undefined) {
    return [{ field: 'tripId', reason: 'Es requerido.' }];
  }

  const details: ErrorDetail[] = [];
  if (tripId !== undefined && !esTextoNoVacio(tripId)) {
    details.push({ field: 'tripId', reason: 'Debe ser un texto no vacío.' });
  }
  if (viajeId !== undefined && !esTextoNoVacio(viajeId)) {
    details.push({ field: 'viajeId', reason: 'Debe ser un texto no vacío.' });
  }
  if (details.length === 0 && tripId !== undefined && viajeId !== undefined && tripId !== viajeId) {
    details.push({ field: 'viajeId', reason: 'No coincide con tripId.' });
  }
  return details;
}

// Cuerpo de POST /tickets, ya normalizado: tripId y viajeId quedan en tripId.
export function leerNuevoTicket(body: unknown): { tripId: string; motivo: string } {
  const { tripId, viajeId, motivo } = comoObjeto(body);

  const details = validarTripId(tripId, viajeId);
  if (!esTextoNoVacio(motivo)) {
    details.push({ field: 'motivo', reason: 'Debe ser un texto no vacío.' });
  }
  if (details.length > 0) {
    throw validationError(details);
  }

  return { tripId: (tripId ?? viajeId) as string, motivo: motivo as string };
}

// Cuerpo de PATCH /tickets/:id/estado.
export function leerCambioDeEstado(body: unknown): { estado: TicketStatus } {
  const { estado } = comoObjeto(body);

  if (!ESTADOS_VALIDOS.includes(estado as TicketStatus)) {
    throw validationError([{ field: 'estado', reason: 'Valores permitidos: ABIERTO, EN_PROCESO, RESUELTO.' }]);
  }

  return { estado: estado as TicketStatus };
}
