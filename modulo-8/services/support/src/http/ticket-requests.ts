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

// Cuerpo de PATCH /tickets/:id/estado. motivo es opcional; en blanco equivale
// a no enviarlo. expectedVersion es opcional: los clientes de AE1 no lo envían.
export function leerCambioDeEstado(body: unknown): {
  estado: TicketStatus;
  motivo: string | null;
  expectedVersion?: number;
} {
  const { estado, motivo, expectedVersion } = comoObjeto(body);

  const details: ErrorDetail[] = [];
  if (!ESTADOS_VALIDOS.includes(estado as TicketStatus)) {
    details.push({ field: 'estado', reason: 'Valores permitidos: ABIERTO, EN_PROCESO, RESUELTO.' });
  }
  if (motivo !== undefined && typeof motivo !== 'string') {
    details.push({ field: 'motivo', reason: 'Debe ser un texto.' });
  }
  if (expectedVersion !== undefined && !(Number.isInteger(expectedVersion) && (expectedVersion as number) >= 1)) {
    details.push({ field: 'expectedVersion', reason: 'Debe ser un entero positivo.' });
  }
  if (details.length > 0) {
    throw validationError(details);
  }

  return {
    estado: estado as TicketStatus,
    motivo: esTextoNoVacio(motivo) ? motivo : null,
    expectedVersion: expectedVersion as number | undefined,
  };
}

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

// Cabecera Idempotency-Key: opcional. Si viene, no puede estar vacía.
export function leerIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  if (!esTextoNoVacio(header)) {
    throw validationError([{ field: 'Idempotency-Key', reason: 'No puede estar vacía.' }]);
  }
  if (header.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw validationError([
      { field: 'Idempotency-Key', reason: `No puede superar los ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres.` },
    ]);
  }
  return header;
}

const ACTOR_MAX_LENGTH = 255;

// Cabecera X-Actor-Id: quién hace el pedido. String opaco; null si no viene.
export function leerActor(header: string | undefined): string | null {
  if (!esTextoNoVacio(header)) {
    return null;
  }
  if (header.length > ACTOR_MAX_LENGTH) {
    throw validationError([{ field: 'X-Actor-Id', reason: `No puede superar los ${ACTOR_MAX_LENGTH} caracteres.` }]);
  }
  return header;
}
