// Catálogo de códigos de error de Support. Debe coincidir con el enum del
// contrato OpenAPI (openapi/rf85-support.yaml); lo verifica el test de contrato.
export const SUPPORT_ERROR_CODES = [
  'SUPPORT_VALIDATION_ERROR',
  'SUPPORT_TICKET_NOT_FOUND',
  'SUPPORT_INVALID_TRANSITION',
  'SUPPORT_CONCURRENCY_CONFLICT',
  'SUPPORT_IDEMPOTENCY_CONFLICT',
  'SUPPORT_TRIP_NOT_FOUND',
  'SUPPORT_TRIP_SERVICE_UNAVAILABLE',
  'SUPPORT_DB_UNAVAILABLE',
  'SUPPORT_INTERNAL_ERROR',
] as const;

export type SupportErrorCode = (typeof SUPPORT_ERROR_CODES)[number];

export interface ErrorDetail {
  field: string;
  reason: string;
}

// Error previsible de Support: lleva el código interno y el estado HTTP con
// el que se informa.
export class SupportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: SupportErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'SupportError';
  }

  // Si se indica, la respuesta lleva la cabecera Retry-After.
  retryAfterSeconds?: number;
}

export function validationError(details: ErrorDetail[]): SupportError {
  return new SupportError(400, 'SUPPORT_VALIDATION_ERROR', 'La solicitud contiene datos inválidos.', details);
}

export function ticketNotFound(): SupportError {
  return new SupportError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Ticket no encontrado.');
}

export function concurrencyConflict(): SupportError {
  return new SupportError(
    409,
    'SUPPORT_CONCURRENCY_CONFLICT',
    'El ticket cambió desde la última lectura. Consultalo de nuevo y reintentá.',
  );
}

export function idempotencyConflict(): SupportError {
  return new SupportError(
    409,
    'SUPPORT_IDEMPOTENCY_CONFLICT',
    'La Idempotency-Key ya se usó con un pedido distinto.',
  );
}

// La base de datos no puede atender el pedido ahora. cause conserva el error
// original para el log; nunca sale en la respuesta.
export function databaseUnavailable(cause?: unknown): SupportError {
  const error = new SupportError(
    503,
    'SUPPORT_DB_UNAVAILABLE',
    'El servicio de soporte no está disponible en este momento. Reintentá en unos instantes.',
  );
  error.cause = cause;
  return error;
}

export function tripNotFound(): SupportError {
  return new SupportError(422, 'SUPPORT_TRIP_NOT_FOUND', 'El viaje indicado no existe.', [
    { field: 'tripId', reason: 'M6 no tiene un viaje con ese identificador.' },
  ]);
}

const TRIP_SERVICE_RETRY_AFTER_SECONDS = 5;

// M6 no pudo confirmar si el viaje existe. El mismo pedido va a funcionar
// cuando M6 se recupere: por eso 503 con Retry-After. cause conserva el error
// original; nunca sale en la respuesta.
export function tripServiceUnavailable(cause?: unknown): SupportError {
  const error = new SupportError(
    503,
    'SUPPORT_TRIP_SERVICE_UNAVAILABLE',
    'No fue posible verificar el viaje en este momento. Reintentá en unos instantes.',
  );
  error.cause = cause;
  error.retryAfterSeconds = TRIP_SERVICE_RETRY_AFTER_SECONDS;
  return error;
}

export function invalidTransition(desde: string, hacia: string): SupportError {
  return new SupportError(409, 'SUPPORT_INVALID_TRANSITION', 'El cambio de estado no está permitido.', [
    { field: 'estado', reason: `No se permite pasar de ${desde} a ${hacia}.` },
  ]);
}
