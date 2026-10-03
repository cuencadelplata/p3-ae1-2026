// Segundos sugeridos al cliente para reintentar (header Retry-After).
// Se lee al usarse (no al importar) para respetar las variables cargadas por dotenv.
export function defaultRetryAfterSeconds(): number {
  return parseInt(process.env.SERVICE_RETRY_AFTER_SECONDS || '10', 10) || 10;
}

/**
 * Error de infraestructura: una dependencia (PostgreSQL, Redis) no está disponible.
 * El middleware de errores lo traduce a 503 Service Unavailable.
 */
export class ServiceUnavailableError extends Error {
  readonly retryAfter: number;

  constructor(message = 'Servicio no disponible temporalmente', retryAfter = defaultRetryAfterSeconds()) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.retryAfter = retryAfter;
  }
}

// Códigos de red de Node.js que indican que no se pudo llegar a la dependencia
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE'
]);

// Códigos SQLSTATE de PostgreSQL que indican caída, reinicio o timeout del servidor
const POSTGRES_UNAVAILABLE_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57014', // query_canceled (statement_timeout)
  '53300'  // too_many_connections
]);

// Mensajes que lanzan pg / pg-pool al vencer un timeout o perder la conexión
const UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'Query read timeout'
];

/**
 * Texto breve para logs. Algunos errores de red (AggregateError de Node) tienen mensaje vacío,
 * así que se usa el código (ej. ECONNREFUSED) como respaldo.
 */
export function describeError(error: any): string {
  return error?.message || error?.code || error?.name || String(error);
}

/**
 * Indica si un error se debe a que una dependencia no está disponible
 * (conexión rechazada, timeout, DB apagada) y no a un bug del código.
 * Revisa también la causa (`cause`) y los errores agrupados (`AggregateError`).
 */
export function isServiceUnavailableError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3) return false;
  if (error instanceof ServiceUnavailableError) return true;

  const { code, message, cause, errors } = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    errors?: unknown;
  };

  if (typeof code === 'string') {
    if (NETWORK_ERROR_CODES.has(code)) return true;
    // Clase 08 de SQLSTATE: connection_exception
    if (code.startsWith('08') || POSTGRES_UNAVAILABLE_CODES.has(code)) return true;
  }
  if (typeof message === 'string' && UNAVAILABLE_MESSAGES.some((m) => message.includes(m))) return true;
  if (cause && isServiceUnavailableError(cause, depth + 1)) return true;
  if (Array.isArray(errors) && errors.some((e) => isServiceUnavailableError(e, depth + 1))) return true;

  return false;
}
