import type { ValidationResult } from '../validators/receipt.validator';

/**
 * Sobre comun de todos los mensajes publicados en mobility.events
 * (catalogo de eventos v1, seccion 3).
 */
export interface EventEnvelope<TData = Record<string, unknown>> {
  messageId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: TData;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Interpreta y valida el sobre de un mensaje recibido de RabbitMQ. */
export function parseEnvelope(content: Buffer): ValidationResult<EventEnvelope> {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8'));
  } catch {
    return { ok: false, errors: ['el mensaje no es un JSON valido'] };
  }

  if (!isObject(raw)) {
    return { ok: false, errors: ['el mensaje debe ser un objeto JSON'] };
  }

  const errors: string[] = [];

  if (typeof raw['messageId'] !== 'string' || !UUID_PATTERN.test(raw['messageId'])) {
    errors.push('messageId debe ser un UUID');
  }
  if (!isNonEmptyText(raw['eventType'])) {
    errors.push('eventType es obligatorio');
  }
  if (!Number.isInteger(raw['version']) || (raw['version'] as number) < 1) {
    errors.push('version debe ser un entero mayor o igual a 1');
  }
  if (typeof raw['occurredAt'] !== 'string' || Number.isNaN(Date.parse(raw['occurredAt']))) {
    errors.push('occurredAt debe ser una fecha ISO 8601');
  }
  if (!isNonEmptyText(raw['correlationId'])) {
    errors.push('correlationId es obligatorio');
  }
  if (!isNonEmptyText(raw['producer'])) {
    errors.push('producer es obligatorio');
  }
  if (!isObject(raw['data'])) {
    errors.push('data debe ser un objeto');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: raw as unknown as EventEnvelope };
}
