import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = (level: LogLevel, message: string, fields?: LogFields) => void;

const SERVICE_NAME = "qr";
const RESERVED_FIELDS = new Set(["timestamp", "level", "service", "component", "message", "correlationId"]);

const context = new AsyncLocalStorage<{ readonly correlationId: string }>();

// Ejecuta fn con un correlationId asociado: todo log emitido durante esa ejecución, incluso
// en funciones asíncronas anidadas, lo incluye sin pasarlo de mano en mano.
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return context.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

// Logs estructurados: una línea JSON por evento.
//
// Regla: los campos son identificadores técnicos (tripId, prefijo del tokenHash, códigos y
// motivos de error). Nunca el token en claro, el cuerpo de la solicitud ni datos personales.
// Los campos adicionales no pueden reemplazar los campos fijos de la línea.
export function createLogger(component: string): Logger {
  return (level, message, fields = {}) => {
    const entry: LogFields = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      component,
      message,
      correlationId: currentCorrelationId(),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!RESERVED_FIELDS.has(key)) {
        entry[key] = value;
      }
    }
    console[level](JSON.stringify(entry));
  };
}

// Campos de un error para el log: nombre, mensaje y pila. La pila queda sólo en el log.
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, reason: error.message || (error as { code?: string }).code, stack: error.stack };
  }
  return { reason: String(error) };
}
