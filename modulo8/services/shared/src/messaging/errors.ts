/**
 * Error base de infraestructura de mensajeria RF8.6.
 */
export class MessagingError extends Error {
  constructor(message: string, public readonly isRetryable: boolean = true) {
    super(message);
    this.name = 'MessagingError';
  }
}

/** Error fatal/no reintentable (ej. mensaje corrupto, JSON invalido, esquema incompatible). */
export class NonRetryableMessagingError extends MessagingError {
  constructor(message: string) {
    super(message, false);
    this.name = 'NonRetryableMessagingError';
  }
}

/** Error transitorio/reintentable (ej. timeout de DB o conexion no disponible). */
export class RetryableMessagingError extends MessagingError {
  constructor(message: string) {
    super(message, true);
    this.name = 'RetryableMessagingError';
  }
}
