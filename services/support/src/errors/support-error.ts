export type SupportErrorCode =
  | 'SUPPORT_VALIDATION_ERROR'
  | 'SUPPORT_TICKET_NOT_FOUND'
  | 'SUPPORT_INVALID_TRANSITION'
  | 'SUPPORT_INTERNAL_ERROR';

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

export function invalidTransition(desde: string, hacia: string): SupportError {
  return new SupportError(409, 'SUPPORT_INVALID_TRANSITION', 'El cambio de estado no está permitido.', [
    { field: 'estado', reason: `No se permite pasar de ${desde} a ${hacia}.` },
  ]);
}
