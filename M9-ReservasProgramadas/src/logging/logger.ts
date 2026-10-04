import { getRequestContext } from '../integration/request-context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  eventId?: string;
  reservaId?: string;
  requestId?: string;
  component?: string;
  [key: string]: unknown;
}

export const log = (level: LogLevel, message: string, context: LogContext = {}): void => {
  const inheritedCorrelationId = getRequestContext()?.correlationId;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(inheritedCorrelationId === undefined ? {} : { correlationId: inheritedCorrelationId }),
    ...context,
  });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
};

export const safeErrorContext = (error: unknown): LogContext => ({
  errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
});
