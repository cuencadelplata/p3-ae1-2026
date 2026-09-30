import { AsyncLocalStorage } from 'node:async_hooks';

import { env } from '../config/env';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type Logger = (level: LogLevel, message: string, fields?: LogFields) => void;

const context = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * Ejecuta fn con un correlationId asociado: todo log emitido durante esa
 * ejecucion, incluso en funciones asincronicas anidadas, lo incluye sin tener
 * que pasarlo de mano en mano.
 */
export function withCorrelationId<T>(correlationId: string | undefined, fn: () => T): T {
  return correlationId ? context.run({ correlationId }, fn) : fn();
}

export function currentCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

/**
 * Logs estructurados: una linea JSON por evento, para poder filtrarlos por
 * correlationId y reconstruir el recorrido de un viaje entre HTTP, la base y
 * RabbitMQ.
 *
 * Regla: los campos son identificadores tecnicos (tripId, messageId,
 * receiptId, codigos de error). Nunca nombres, emails, documentos, destinos de
 * envio ni tokens de descarga.
 */
export function createLogger(component: string): Logger {
  return (level, message, fields = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: env.serviceName,
      component,
      message,
      correlationId: currentCorrelationId(),
      ...fields,
    };
    console[level](JSON.stringify(entry));
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Campos de un error inesperado: el mensaje y la pila, sin el objeto completo. */
export function errorFields(error: unknown): LogFields {
  return error instanceof Error ? { reason: error.message, stack: error.stack } : { reason: String(error) };
}
