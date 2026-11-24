/**
 * Redacción de datos sensibles para logs y atributos de telemetría.
 *
 * Nunca se envían: Authorization, tokens, contraseñas, cookies, cuerpos completos,
 * direcciones o coordenadas de clientes. Los UUID de reserva/evento/correlación sí se
 * permiten como campos de log (nunca como etiquetas de métricas).
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /authorization|token|password|passwd|secret|cookie|api[-_]?key|credential|body|origen|destino|origin|destination|address|direccion|latitude|longitude|^lat$|^lng$|coordinates|^routesnapshot$/i;

const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 4;

/** Elimina usuario/contraseña embebidos en URLs (p. ej. amqp://user:pass@host). */
export const stripUrlCredentials = (value: string): string =>
  value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(:[^/\s@]*)?@/gi, '$1[REDACTED]@');

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') {
    const clean = stripUrlCredentials(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, REDACTED);
    return clean.length > MAX_STRING_LENGTH ? `${clean.slice(0, MAX_STRING_LENGTH)}…` : clean;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  return sanitizeRecord(value as Record<string, unknown>, depth + 1);
};

const sanitizeRecord = (
  record: Record<string, unknown>,
  depth: number,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(value, depth);
  }
  return result;
};

export const redact = (record: Record<string, unknown>): Record<string, unknown> =>
  sanitizeRecord(record, 0);

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Acepta un correlationId externo solo si es corto y de caracteres seguros. */
export const isValidCorrelationId = (value: string | undefined): value is string =>
  value !== undefined && CORRELATION_ID_PATTERN.test(value);
