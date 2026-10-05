export interface EventEnvelope<TData = Record<string, unknown>> {
  messageId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: TData;
}

export interface EnvelopeValidationResult {
  ok: boolean;
  value?: EventEnvelope;
  errors?: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Valida el sobre canónico M8 segun el catalogo de eventos v1 y seccion 5 del Informe Base AE2.
 */
export function parseEnvelope(content: Buffer | string): EnvelopeValidationResult {
  let raw: unknown;
  try {
    const str = typeof content === 'string' ? content : content.toString('utf8');
    raw = JSON.parse(str);
  } catch {
    return { ok: false, errors: ['el mensaje no es un JSON valido'] };
  }

  if (!isObject(raw)) {
    return { ok: false, errors: ['el mensaje debe ser un objeto JSON'] };
  }

  const errors: string[] = [];

  if (typeof raw['messageId'] !== 'string' || !UUID_PATTERN.test(raw['messageId'])) {
    errors.push('messageId debe ser un UUID valido');
  }
  if (!isNonEmptyText(raw['eventType'])) {
    errors.push('eventType es obligatorio');
  }
  if (!Number.isInteger(raw['version']) || (raw['version'] as number) < 1) {
    errors.push('version debe ser un entero mayor o igual a 1');
  }
  if (typeof raw['occurredAt'] !== 'string' || Number.isNaN(Date.parse(raw['occurredAt']))) {
    errors.push('occurredAt debe ser una fecha ISO 8601 valida');
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
