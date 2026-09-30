/**
 * Codigos que indican que PostgreSQL no esta disponible, a diferencia de un
 * error de la consulta: errores de red de Node y clases 08 (conexion) y 57P
 * (servidor apagandose o arrancando) de PostgreSQL.
 */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE']);
const POSTGRES_CODES = new Set(['08000', '08001', '08003', '08004', '08006', '57P01', '57P02', '57P03']);

/** Mensajes de pg sin codigo: timeout del pool y conexion cortada. */
const POOL_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'connection timeout',
  'Client has encountered a connection error',
];

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (NETWORK_CODES.has(code) || POSTGRES_CODES.has(code))) {
    return true;
  }
  if (POOL_MESSAGES.some((message) => error.message.includes(message))) {
    return true;
  }

  // Node informa un fallo de conexion en varias direcciones (IPv4 e IPv6) como
  // AggregateError, a veces sin codigo propio.
  if (error instanceof AggregateError) {
    return error.errors.some(isDatabaseUnavailable);
  }
  return error.cause !== undefined && isDatabaseUnavailable(error.cause);
}
