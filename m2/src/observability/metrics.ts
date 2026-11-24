import type { Request, RequestHandler } from 'express';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { CircuitStatus, DependencyName } from '../resilience/policies.js';

const CIRCUIT_STATES = ['closed', 'open', 'half_open', 'isolated'] as const;

export type CacheOperation = 'get' | 'set' | 'invalidate';
export type CacheOutcome = 'hit' | 'miss' | 'success' | 'error';

export const metricsRegistry = new Registry();

const httpRequests = new Counter({
  name: 'm2_http_requests_total',
  help: 'Total de solicitudes HTTP del módulo M2',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry]
});

const httpRequestDuration = new Histogram({
  name: 'm2_http_request_duration_seconds',
  help: 'Duración de solicitudes HTTP del módulo M2',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry]
});

const cacheOperations = new Counter({
  name: 'm2_cache_operations_total',
  help: 'Operaciones de caché de perfiles por resultado',
  labelNames: ['operation', 'outcome'],
  registers: [metricsRegistry]
});

const circuitState = new Gauge({
  name: 'm2_circuit_state',
  help: 'Estado one-hot de cada circuit breaker',
  labelNames: ['dependency', 'state'],
  registers: [metricsRegistry]
});

// ---------------------------------------------------------------------------
// RF-2.2 Direcciones frecuentes
// Ninguna métrica lleva clienteId ni direcciones como etiqueta: serían datos personales
// (RNF-23) y además crearían una serie por cliente (cardinalidad sin límite).
// ---------------------------------------------------------------------------

export type OperacionDireccion = 'alta' | 'edicion' | 'baja';
export type ResultadoOperacion =
  | 'ok'
  | 'replay'
  | 'conflicto_idempotencia'
  | 'duplicada'
  | 'conflicto_version'
  | 'conflicto_concurrente'
  | 'no_encontrada'
  | 'error';
export type ResultadoCacheDirecciones = 'hit' | 'miss' | 'bypass';
export type ViaViajeReciente = 'rest' | 'evento_m2' | 'evento_m6';
export type ResultadoViajeReciente = 'nuevo' | 'duplicado' | 'error';
export type ResultadoMensaje = 'procesado' | 'reintento' | 'dlq' | 'contrato_invalido';

const direccionesOperaciones = new Counter({
  name: 'm2_direcciones_operaciones_total',
  help: 'Altas, ediciones y bajas de direcciones favoritas por resultado (incluye repeticiones idempotentes y conflictos)',
  labelNames: ['operacion', 'resultado'],
  registers: [metricsRegistry]
});

const direccionesReintentos = new Counter({
  name: 'm2_direcciones_reintentos_transaccion_total',
  help: 'Reintentos de transacciones serializables por conflicto concurrente (reintento) y los que se agotaron (agotado)',
  labelNames: ['resultado'],
  registers: [metricsRegistry]
});

const direccionesCache = new Counter({
  name: 'm2_direcciones_cache_total',
  help: 'Lecturas de la lista de direcciones según caché Redis: hit, miss o bypass (Redis no disponible)',
  labelNames: ['resultado'],
  registers: [metricsRegistry]
});

const direccionesSugerencias = new Counter({
  name: 'm2_direcciones_sugerencias_total',
  help: 'Sugerencias entregadas, según si incluyen el viaje de regreso B → A',
  labelNames: ['regreso'],
  registers: [metricsRegistry]
});

const direccionesSugerenciasCandidatos = new Histogram({
  name: 'm2_direcciones_sugerencias_candidatos',
  help: 'Cantidad de direcciones candidatas ofrecidas en cada sugerencia (0 = sugerencia vacía)',
  buckets: [0, 1, 2, 3, 5, 10, 20],
  registers: [metricsRegistry]
});

const viajesRecientes = new Counter({
  name: 'm2_direcciones_viajes_recientes_total',
  help: 'Viajes completados registrados como direcciones recientes, por vía de ingreso y resultado (duplicado = idempotencia por viajeId)',
  labelNames: ['via', 'resultado'],
  registers: [metricsRegistry]
});

const geocodificacionDuracion = new Histogram({
  name: 'm2_geocodificacion_duracion_segundos',
  help: 'Duración de las consultas de geocodificación a M4, por resultado',
  labelNames: ['resultado'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3],
  registers: [metricsRegistry]
});

// Mensajería (las registra el worker)
const mensajesConsumidos = new Counter({
  name: 'm2_mensajes_consumidos_total',
  help: 'Mensajes de RabbitMQ consumidos por cola y resultado (procesado, reintento, dlq, contrato_invalido)',
  labelNames: ['cola', 'resultado'],
  registers: [metricsRegistry]
});

const mensajesDuracion = new Histogram({
  name: 'm2_mensajes_procesamiento_segundos',
  help: 'Tiempo de procesamiento de cada mensaje consumido',
  labelNames: ['cola'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry]
});

const outboxPublicados = new Counter({
  name: 'm2_outbox_publicados_total',
  help: 'Eventos del outbox publicados en RabbitMQ, por tipo',
  labelNames: ['tipo'],
  registers: [metricsRegistry]
});

const outboxDemora = new Histogram({
  name: 'm2_outbox_demora_segundos',
  help: 'Demora entre que el evento se guarda en el outbox y se publica en RabbitMQ',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300],
  registers: [metricsRegistry]
});

export function recordOperacionDireccion(operacion: OperacionDireccion, resultado: ResultadoOperacion): void {
  direccionesOperaciones.inc({ operacion, resultado });
}

export function recordReintentoTransaccion(resultado: 'reintento' | 'agotado'): void {
  direccionesReintentos.inc({ resultado });
}

export function recordCacheDirecciones(resultado: ResultadoCacheDirecciones): void {
  direccionesCache.inc({ resultado });
}

export function recordSugerencia(conRegreso: boolean, candidatos: number): void {
  direccionesSugerencias.inc({ regreso: conRegreso ? 'si' : 'no' });
  direccionesSugerenciasCandidatos.observe(candidatos);
}

export function recordViajeReciente(via: ViaViajeReciente, resultado: ResultadoViajeReciente): void {
  viajesRecientes.inc({ via, resultado });
}

export function startGeocodificacionTimer(): (resultado: 'ok' | 'error') => void {
  const stop = geocodificacionDuracion.startTimer();
  return (resultado) => { stop({ resultado }); };
}

export function startMensajeTimer(cola: string): (resultado: ResultadoMensaje) => void {
  const stop = mensajesDuracion.startTimer({ cola });
  return (resultado) => {
    stop();
    mensajesConsumidos.inc({ cola, resultado });
  };
}

export function recordOutboxPublicado(tipo: string, creadoEn: Date): void {
  outboxPublicados.inc({ tipo });
  outboxDemora.observe(Math.max(0, (Date.now() - creadoEn.getTime()) / 1000));
}

/** Gauge de eventos pendientes en el outbox; se calcula en cada scrape (solo lo registra el worker). */
export function registerOutboxPendientes(contar: () => Promise<number>): void {
  if (metricsRegistry.getSingleMetric('m2_outbox_pendientes')) return;
  new Gauge({
    name: 'm2_outbox_pendientes',
    help: 'Eventos guardados en el outbox que todavía no se publicaron en RabbitMQ',
    registers: [metricsRegistry],
    async collect() {
      try { this.set(await contar()); } catch { /* Sin base no se informa un valor nuevo. */ }
    }
  });
}

function routeLabel(req: Request): string {
  const routePath: unknown = req.route?.path;
  return typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : 'unmatched';
}

export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
  const stopTimer = httpRequestDuration.startTimer();
  res.once('finish', () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode)
    };
    httpRequests.inc(labels);
    stopTimer(labels);
  });
  next();
};

export function recordCacheOperation(operation: CacheOperation, outcome: CacheOutcome): void {
  cacheOperations.inc({ operation, outcome });
}

export function recordCircuitState(dependency: DependencyName, current: CircuitStatus): void {
  for (const state of CIRCUIT_STATES) {
    circuitState.set({ dependency, state }, state === current ? 1 : 0);
  }
}

export const metricsHandler: RequestHandler = (_req, res, next) => {
  metricsRegistry.metrics().then((body) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.status(200).send(body);
  }).catch(next);
};
