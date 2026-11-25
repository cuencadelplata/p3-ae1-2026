import { validationError, type ErrorDetail } from '../errors/support-error.js';
import type { TicketStatus } from '../models/ticket.model.js';
import type { OrdenDeTickets } from '../repositories/ticket.repository.js';

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
  registrarRespuesta: boolean;
} {
  const { estado, motivo, expectedVersion, registrarRespuesta } = comoObjeto(body);

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
  if (registrarRespuesta !== undefined && typeof registrarRespuesta !== 'boolean') {
    details.push({ field: 'registrarRespuesta', reason: 'Debe ser un booleano.' });
  }
  if (registrarRespuesta === true && (!esTextoNoVacio(motivo) || expectedVersion === undefined)) {
    details.push({ field: 'registrarRespuesta', reason: 'Una respuesta requiere texto y la versión actual del ticket.' });
  }
  if (details.length > 0) {
    throw validationError(details);
  }

  return {
    estado: estado as TicketStatus,
    motivo: esTextoNoVacio(motivo) ? motivo : null,
    expectedVersion: expectedVersion as number | undefined,
    registrarRespuesta: registrarRespuesta === true,
  };
}

export function leerMensaje(body: unknown): { texto: string; expectedVersion: number } {
  const { texto, expectedVersion } = comoObjeto(body);
  const details: ErrorDetail[] = [];
  if (!esTextoNoVacio(texto) || texto.trim().length > 2000) {
    details.push({ field: 'texto', reason: 'Escribí un mensaje de entre 1 y 2000 caracteres.' });
  }
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    details.push({ field: 'expectedVersion', reason: 'Debe ser un entero positivo.' });
  }
  if (details.length) throw validationError(details);
  return { texto: (texto as string).trim(), expectedVersion: expectedVersion as number };
}

export const LIMITE_MAXIMO = 100;

// Query de GET /tickets. Todos los filtros son opcionales; un parámetro
// presente pero vacío, repetido o fuera de rango es un error.
export function leerConsultaDeTickets(query: unknown): {
  tripId?: string;
  estado?: TicketStatus;
  orden?: OrdenDeTickets;
  limit?: number;
  cursor?: string;
} {
  const { tripId, viajeId, estado, orden, limit, cursor } = comoObjeto(query);

  const details: ErrorDetail[] = tripId === undefined && viajeId === undefined ? [] : validarTripId(tripId, viajeId);
  if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado as TicketStatus)) {
    details.push({ field: 'estado', reason: 'Valores permitidos: ABIERTO, EN_PROCESO, RESUELTO.' });
  }
  if (orden !== undefined && orden !== 'asc' && orden !== 'desc') {
    details.push({ field: 'orden', reason: 'Valores permitidos: asc, desc.' });
  }
  const limite = typeof limit === 'string' && /^[0-9]+$/.test(limit) ? Number(limit) : NaN;
  if (limit !== undefined && !(limite >= 1 && limite <= LIMITE_MAXIMO)) {
    details.push({ field: 'limit', reason: `Debe ser un entero entre 1 y ${LIMITE_MAXIMO}.` });
  }
  if (cursor !== undefined && !esTextoNoVacio(cursor)) {
    details.push({ field: 'cursor', reason: 'No es un cursor válido.' });
  }
  if (details.length > 0) {
    throw validationError(details);
  }

  return {
    tripId: (tripId ?? viajeId) as string | undefined,
    estado: estado as TicketStatus | undefined,
    orden: orden as OrdenDeTickets | undefined,
    limit: limit === undefined ? undefined : limite,
    cursor: cursor as string | undefined,
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
