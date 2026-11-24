import { logs, SeverityNumber, type AnyValue } from '@opentelemetry/api';

import { getRequestContext } from '../integration/request-context.js';
import { telemetryConfig } from '../observability/config.js';
import { redact } from '../observability/redaction.js';
import { currentTraceIds } from '../observability/tracing.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  eventId?: string;
  reservaId?: string;
  requestId?: string;
  component?: string;
  [key: string]: unknown;
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const serviceFields = (): { service: string; environment: string } => {
  try {
    const config = telemetryConfig();
    return { service: config.serviceName, environment: config.environment };
  } catch {
    return { service: 'm9-reservas', environment: 'desconocido' };
  }
};

/**
 * Log estructurado JSON en stdout (formato existente) + registro OTLP cuando la telemetría
 * está activa. Sin LoggerProvider global la emisión OTLP es no-op: hay una sola vía de
 * ingesta hacia Grafana Cloud (OTLP → Alloy), stdout queda para uso local/docker logs.
 */
export const log = (level: LogLevel, message: string, context: LogContext = {}): void => {
  const inheritedCorrelationId = getRequestContext()?.correlationId;
  const traceIds = currentTraceIds();
  const fields = redact({
    ...(inheritedCorrelationId === undefined ? {} : { correlationId: inheritedCorrelationId }),
    ...context,
  });
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...serviceFields(),
    ...(traceIds === undefined ? {} : { trace_id: traceIds.traceId, span_id: traceIds.spanId }),
    ...fields,
  };

  const serialized = JSON.stringify(entry);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.info(serialized);

  try {
    // trace_id/span_id viajan en el contexto del registro OTLP (correlación log → traza).
    logs.getLogger('m9-reservas').emit({
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: fields as Record<string, AnyValue>,
    });
  } catch {
    // Un fallo de telemetría nunca interrumpe el log local.
  }
};

export const safeErrorContext = (error: unknown): LogContext => ({
  errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
  ...(error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string' &&
  /^P[0-9]{4}$/.test(error.code)
    ? { errorCode: error.code }
    : {}),
});
