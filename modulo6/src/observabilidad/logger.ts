import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import pino from 'pino';

// Logs estructurados (JSON) con identificadores de correlación (RNF-13):
// - requestId: X-Request-Id recibido o generado, se devuelve en la respuesta.
// - tripId: id del viaje cuando la ruta lo incluye.
// - trace_id / span_id: los agrega la instrumentación OTel de pino y enlazan el log con la traza.
// Nunca se registran datos de tarjeta, emails ni tokens (RNF-23).

interface ContextoSolicitud {
    requestId: string;
    tripId?: string;
}

const contexto = new AsyncLocalStorage<ContextoSolicitud>();
const REQUEST_ID_VALIDO = /^[A-Za-z0-9._:-]{1,128}$/;

export const logger = pino({
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' || process.env.VITEST ? 'silent' : 'info'),
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'm6-viajes', modulo: 'M6' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    formatters: { level: (label) => ({ level: label }) },
    mixin: () => {
        const actual = contexto.getStore();
        return actual ? { requestId: actual.requestId, ...(actual.tripId ? { tripId: actual.tripId } : {}) } : {};
    },
    redact: {
        paths: [
            'token', 'email', 'password', 'authorization',
            '*.token', '*.email', '*.password', '*.authorization',
            'pago', '*.pago', 'body.pago', 'req.headers.authorization', 'req.headers["x-api-key"]',
        ],
        censor: '[oculto]',
    },
});

/** Ejecuta `fn` con un contexto de correlación (usado por el middleware y por tareas en segundo plano). */
export function conContexto<T>(requestId: string | undefined, fn: () => T): T {
    const id = requestId && REQUEST_ID_VALIDO.test(requestId) ? requestId : randomUUID();
    return contexto.run({ requestId: id }, fn);
}

export function requestIdActual(): string | undefined {
    return contexto.getStore()?.requestId;
}

/** Asocia el viaje a la solicitud en curso: aparece en los logs y como atributo de la traza. */
export function asociarViaje(tripId: string): void {
    const actual = contexto.getStore();
    if (actual) actual.tripId = tripId;
    const span = trace.getActiveSpan();
    span?.setAttribute('m6.trip_id', tripId);
}
