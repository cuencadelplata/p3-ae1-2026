// Catálogo de códigos de error de Support. Debe coincidir con el enum del
// contrato OpenAPI (openapi/rf85-support.yaml); lo verifica el test de contrato.
export const SUPPORT_ERROR_CODES = [
  'SUPPORT_VALIDATION_ERROR',
  'SUPPORT_TICKET_NOT_FOUND',
  'SUPPORT_INVALID_TRANSITION',
  'SUPPORT_CONCURRENCY_CONFLICT',
  'SUPPORT_IDEMPOTENCY_CONFLICT',
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

export function invalidTransition(desde: string, hacia: string): SupportError {
  return new SupportError(409, 'SUPPORT_INVALID_TRANSITION', 'El cambio de estado no está permitido.', [
    { field: 'estado', reason: `No se permite pasar de ${desde} a ${hacia}.` },
  ]);
}
