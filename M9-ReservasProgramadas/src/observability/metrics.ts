import {
  metrics,
  ValueType,
  type Attributes,
  type Meter,
  type MeterProvider,
  type ObservableResult,
} from '@opentelemetry/api';

/**
 * Catálogo de métricas propias de M9 (ver observability/docs/catalogo-senales.md).
 *
 * Reglas:
 * - Duraciones en segundos (unidad `s`) con buckets explícitos.
 * - Etiquetas de cardinalidad acotada: nunca UUID, rutas concretas ni query strings.
 * - Los instrumentos se crean de forma perezosa y se reconstruyen si cambia el
 *   MeterProvider global (la API de métricas no tiene proxy, a diferencia de trazas).
 * - Sin proveedor configurado, todo es no-op.
 */

export const METER_NAME = 'm9-reservas';

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DELAY_BUCKETS = [1, 2.5, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

const KNOWN_EVENT_TYPES = new Set([
  'reservation.created.v1',
  'reservation.updated.v1',
  'reservation.cancelled.v1',
  'reservation.ready-for-dispatch.v1',
  'reservation.activated.v1',
  'reservation.failed.v1',
  'ride-request.assigned.v1',
  'ride-request.failed.v1',
]);

/** Evita que un tipo de evento externo arbitrario genere series nuevas. */
export const boundedEventType = (value: unknown): string =>
  typeof value === 'string' && KNOWN_EVENT_TYPES.has(value) ? value : 'unknown';

// ---------------------------------------------------------------------------
// Estado observado periódicamente (consultas agregadas de costo acotado).
// ---------------------------------------------------------------------------

export interface DatabaseStateSnapshot {
  collectedAtMs: number;
  reservationsByStatus: Record<string, number>;
  overduePending: number;
  oldestOverdueSeconds: number;
  stuckActivating: number;
  oldestActivatingSeconds: number;
  outboxPending: number;
  outboxOldestPendingSeconds: number;
  outboxFailed: number;
}

export interface QueueStateSnapshot {
  collectedAtMs: number;
  queues: Array<{ queue: string; role: string; messages: number; consumers: number }>;
}

export type CollectorSource = 'database' | 'rabbitmq' | 'dependencies';

interface CollectorStatus {
  up: boolean;
  lastSuccessMs: number | null;
}

export interface DependencyStateSnapshot {
  collectedAtMs: number;
  dependencies: Record<string, boolean>;
}

const observedState: {
  database: DatabaseStateSnapshot | null;
  queues: QueueStateSnapshot | null;
  dependencies: DependencyStateSnapshot | null;
  /** `undefined` = el recolector nunca corrió (no se publica nada). */
  collectors: Partial<Record<CollectorSource, CollectorStatus>>;
  schedulerLastSuccessMs: number | null;
  maxAgeMs: number;
} = {
  database: null,
  queues: null,
  dependencies: null,
  collectors: {},
  schedulerLastSuccessMs: null,
  maxAgeMs: 60_000,
};

export const setObservedStateMaxAge = (maxAgeMs: number): void => {
  observedState.maxAgeMs = maxAgeMs;
};

export const setDatabaseState = (snapshot: DatabaseStateSnapshot): void => {
  observedState.database = snapshot;
  observedState.collectors.database = { up: true, lastSuccessMs: snapshot.collectedAtMs };
};

export const setQueueState = (snapshot: QueueStateSnapshot): void => {
  observedState.queues = snapshot;
  observedState.collectors.rabbitmq = { up: true, lastSuccessMs: snapshot.collectedAtMs };
};

export const setDependencyState = (snapshot: DependencyStateSnapshot): void => {
  observedState.dependencies = snapshot;
  observedState.collectors.dependencies = { up: true, lastSuccessMs: snapshot.collectedAtMs };
};

/** Un fallo del recolector NO publica ceros: las series quedan ausentes hasta recuperarse. */
export const markCollectorFailure = (source: CollectorSource): void => {
  observedState.collectors[source] = {
    up: false,
    lastSuccessMs: observedState.collectors[source]?.lastSuccessMs ?? null,
  };
  if (source === 'database') observedState.database = null;
  else if (source === 'rabbitmq') observedState.queues = null;
  else observedState.dependencies = null;
};

export const markSchedulerSuccess = (atMs = Date.now()): void => {
  observedState.schedulerLastSuccessMs = atMs;
};

export const resetObservedStateForTests = (): void => {
  observedState.database = null;
  observedState.queues = null;
  observedState.dependencies = null;
  observedState.collectors = {};
  observedState.schedulerLastSuccessMs = null;
};

const isFresh = (collectedAtMs: number): boolean =>
  Date.now() - collectedAtMs <= observedState.maxAgeMs;

const freshDatabase = (): DatabaseStateSnapshot | null =>
  observedState.database !== null && isFresh(observedState.database.collectedAtMs)
    ? observedState.database
    : null;

const freshQueues = (): QueueStateSnapshot | null =>
  observedState.queues !== null && isFresh(observedState.queues.collectedAtMs)
    ? observedState.queues
    : null;

const freshDependencies = (): DependencyStateSnapshot | null =>
  observedState.dependencies !== null && isFresh(observedState.dependencies.collectedAtMs)
    ? observedState.dependencies
    : null;

// ---------------------------------------------------------------------------
// Instrumentos
// ---------------------------------------------------------------------------

const buildInstruments = (meter: Meter) => {
  const histogram = (name: string, description: string, buckets = LATENCY_BUCKETS) =>
    meter.createHistogram(name, {
      description,
      unit: 's',
      advice: { explicitBucketBoundaries: buckets },
    });
  const counter = (name: string, description: string, unit: string) =>
    meter.createCounter(name, { description, unit, valueType: ValueType.INT });

  const gauge = (
    name: string,
    description: string,
    unit: string,
    callback: (result: ObservableResult) => void,
  ) => {
    const instrument = meter.createObservableGauge(name, { description, unit });
    instrument.addCallback(callback);
    return instrument;
  };

  // Estado de reservas/Outbox (desde el recolector de base de datos).
  gauge(
    'm9.reservations.by_status',
    'Reservas actuales por estado (consulta agregada periódica).',
    '{reservation}',
    (result) => {
      const state = freshDatabase();
      if (state === null) return;
      for (const [status, count] of Object.entries(state.reservationsByStatus)) {
        result.observe(count, { status });
      }
    },
  );
  gauge(
    'm9.reservations.overdue_pending',
    'Reservas PROGRAMADA cuya fecha ya venció y aún no comenzaron a activarse.',
    '{reservation}',
    (result) => {
      const state = freshDatabase();
      if (state !== null) result.observe(state.overduePending);
    },
  );
  gauge(
    'm9.reservations.oldest_overdue.age',
    'Antigüedad de la reserva PROGRAMADA vencida más vieja (0 si no hay vencidas).',
    's',
    (result) => {
      const state = freshDatabase();
      if (state !== null) result.observe(state.oldestOverdueSeconds);
    },
  );
  gauge(
    'm9.reservations.stuck_activating',
    'Reservas en ACTIVANDO sin cambios por encima del umbral configurado.',
    '{reservation}',
    (result) => {
      const state = freshDatabase();
      if (state !== null) result.observe(state.stuckActivating);
    },
  );
  gauge(
    'm9.reservations.oldest_activating.age',
    'Tiempo desde la última modificación de la reserva ACTIVANDO más antigua.',
    's',
    (result) => {
      const state = freshDatabase();
      if (state !== null) result.observe(state.oldestActivatingSeconds);
    },
  );
  gauge('m9.outbox.pending', 'Eventos Outbox en estado PENDING.', '{event}', (result) => {
    const state = freshDatabase();
    if (state !== null) result.observe(state.outboxPending);
  });
  gauge(
    'm9.outbox.oldest_pending.age',
    'Antigüedad del evento Outbox PENDING más viejo (0 si no hay pendientes).',
    's',
    (result) => {
      const state = freshDatabase();
      if (state !== null) result.observe(state.outboxOldestPendingSeconds);
    },
  );
  gauge('m9.outbox.failed', 'Eventos Outbox en estado FAILED.', '{event}', (result) => {
    const state = freshDatabase();
    if (state !== null) result.observe(state.outboxFailed);
  });

  // Profundidad real de colas RabbitMQ (checkQueue: messageCount/consumerCount).
  gauge(
    'm9.rabbitmq.queue.messages',
    'Mensajes en la cola (listos para entregar) según RabbitMQ.',
    '{message}',
    (result) => {
      const state = freshQueues();
      if (state === null) return;
      for (const queue of state.queues) {
        result.observe(queue.messages, { queue: queue.queue, queue_role: queue.role });
      }
    },
  );
  gauge(
    'm9.rabbitmq.queue.consumers',
    'Consumidores activos por cola según RabbitMQ.',
    '{consumer}',
    (result) => {
      const state = freshQueues();
      if (state === null) return;
      for (const queue of state.queues) {
        result.observe(queue.consumers, { queue: queue.queue, queue_role: queue.role });
      }
    },
  );

  gauge(
    'm9.state_collector.up',
    '1 si la última recolección agregada fue exitosa, 0 si falló.',
    '',
    (result) => {
      for (const [source, status] of Object.entries(observedState.collectors)) {
        result.observe(status.up ? 1 : 0, { source });
      }
    },
  );
  gauge(
    'm9.dependency.up',
    '1 si la dependencia respondió al chequeo de readiness, 0 si no.',
    '',
    (result) => {
      const state = freshDependencies();
      if (state === null) return;
      for (const [dependency, up] of Object.entries(state.dependencies)) {
        result.observe(up ? 1 : 0, { dependency });
      }
    },
  );
  gauge(
    'm9.scheduler.last_success.timestamp',
    'Marca de tiempo Unix (segundos) de la última ejecución exitosa del scheduler.',
    's',
    (result) => {
      if (observedState.schedulerLastSuccessMs !== null) {
        result.observe(observedState.schedulerLastSuccessMs / 1000);
      }
    },
  );

  // Proceso (no host ni contenedor).
  meter
    .createObservableCounter('process.cpu.time', {
      description: 'Tiempo de CPU consumido por el proceso Node.js.',
      unit: 's',
    })
    .addCallback((result) => {
      const usage = process.cpuUsage();
      result.observe(usage.user / 1e6, { 'cpu.mode': 'user' });
      result.observe(usage.system / 1e6, { 'cpu.mode': 'system' });
    });
  meter
    .createObservableGauge('process.memory.usage', {
      description: 'Memoria residente (RSS) del proceso Node.js.',
      unit: 'By',
    })
    .addCallback((result) => {
      result.observe(process.memoryUsage.rss());
    });

  return {
    httpDuration: histogram(
      'http.server.request.duration',
      'Duración de solicitudes HTTP entrantes por método, ruta normalizada y estado.',
    ),
    httpActive: meter.createUpDownCounter('http.server.active_requests', {
      description: 'Solicitudes HTTP en curso.',
      unit: '{request}',
      valueType: ValueType.INT,
    }),
    reservationOperations: counter(
      'm9.reservation.operations',
      'Operaciones de reserva (crear/modificar/cancelar) por resultado, contadas tras el commit.',
      '{operation}',
    ),
    reservationTransitions: counter(
      'm9.reservation.transitions',
      'Transiciones de estado confirmadas en PostgreSQL.',
      '{transition}',
    ),
    activationDelay: histogram(
      'm9.reservation.activation.delay',
      'Retraso entre la fecha programada y el inicio efectivo de la activación.',
      DELAY_BUCKETS,
    ),
    activationResolution: histogram(
      'm9.reservation.activation.resolution',
      'Tiempo desde la fecha programada hasta el resultado final (ACTIVADA/FALLIDA).',
      DELAY_BUCKETS,
    ),
    pricingDegradations: counter(
      'm9.reservation.pricing.degradations',
      'Reservas guardadas sin tarifa/ruta por falla de una dependencia (respuesta 2xx degradada).',
      '{reservation}',
    ),
    schedulerRuns: counter('m9.scheduler.runs', 'Ejecuciones del scheduler.', '{run}'),
    schedulerDuration: histogram(
      'm9.scheduler.run.duration',
      'Duración de una ejecución completa del scheduler.',
    ),
    schedulerFound: counter(
      'm9.scheduler.reservations.found',
      'Reservas candidatas encontradas por el scheduler (PROGRAMADA vencida o ACTIVANDO).',
      '{reservation}',
    ),
    cacheRequests: counter(
      'm9.cache.requests',
      'Operaciones de caché Redis por resultado (hit/miss/bypass/error/ok).',
      '{request}',
    ),
    redisDuration: histogram(
      'm9.redis.operation.duration',
      'Duración de operaciones Redis de caché y locks.',
    ),
    lockAcquisitions: counter(
      'm9.lock.acquisitions',
      'Intentos de adquirir un lock distribuido por resultado.',
      '{attempt}',
    ),
    dbDuration: histogram(
      'm9.db.operation.duration',
      'Duración de operaciones/transacciones de repositorio sobre PostgreSQL.',
    ),
    outboxPublished: counter(
      'm9.outbox.published',
      'Eventos Outbox publicados con confirmación del broker.',
      '{event}',
    ),
    outboxFailures: counter(
      'm9.outbox.failures',
      'Fallas al publicar eventos Outbox por desenlace (retry/dlq).',
      '{event}',
    ),
    outboxBatchDuration: histogram(
      'm9.outbox.batch.duration',
      'Duración de un ciclo de publicación del Outbox.',
    ),
    messagingPublished: counter(
      'm9.messaging.published',
      'Publicaciones AMQP por destino y resultado de confirmación.',
      '{message}',
    ),
    messagingConsumed: counter(
      'm9.messaging.consumed',
      'Mensajes AMQP consumidos por desenlace (ack/retry/dead_letter).',
      '{message}',
    ),
    messagingProcessDuration: histogram(
      'm9.messaging.process.duration',
      'Duración del procesamiento de un mensaje consumido.',
    ),
    inboxResults: counter(
      'm9.inbox.results',
      'Resultados del Inbox transaccional (PROCESSED/DUPLICATE/IGNORED).',
      '{event}',
    ),
    dependencyRequests: counter(
      'm9.dependency.requests',
      'Llamadas REST a dependencias (M5/M7) por resultado.',
      '{request}',
    ),
    dependencyDuration: histogram(
      'm9.dependency.request.duration',
      'Duración de llamadas REST a dependencias (M5/M7).',
    ),
  };
};

type Instruments = ReturnType<typeof buildInstruments>;

let cached: { provider: MeterProvider; instruments: Instruments } | undefined;

export const instruments = (): Instruments => {
  const provider = metrics.getMeterProvider();
  if (cached === undefined || cached.provider !== provider) {
    cached = { provider, instruments: buildInstruments(provider.getMeter(METER_NAME)) };
  }
  return cached.instruments;
};

/** Ejecuta la medición sin que un error de telemetría afecte la operación de negocio. */
const safely = (action: () => void): void => {
  try {
    action();
  } catch {
    // La telemetría nunca debe romper el flujo principal.
  }
};

const seconds = (startMs: number): number => Math.max(0, (performance.now() - startMs) / 1000);

export const now = (): number => performance.now();

// ---------------------------------------------------------------------------
// Funciones de registro por dominio
// ---------------------------------------------------------------------------

export type RouteKind = 'business' | 'health' | 'docs' | 'static' | 'unmatched';

export const recordHttpRequest = (input: {
  method: string;
  route: string;
  statusCode: number;
  kind: RouteKind;
  startMs: number;
}): void =>
  safely(() =>
    instruments().httpDuration.record(seconds(input.startMs), {
      'http.request.method': input.method,
      'http.route': input.route,
      'http.response.status_code': input.statusCode,
      'm9.route.kind': input.kind,
    }),
  );

export const trackActiveRequest = (method: string, delta: 1 | -1): void =>
  safely(() => instruments().httpActive.add(delta, { 'http.request.method': method }));

export type ReservationOperation = 'create' | 'update' | 'cancel';

export const recordReservationOperation = (
  operation: ReservationOperation,
  result: 'success' | 'rejected' | 'error',
  reason = 'none',
): void =>
  safely(() =>
    instruments().reservationOperations.add(1, { operation, result, reason: reason.slice(0, 48) }),
  );

export const recordTransition = (from: string, to: string): void =>
  safely(() => instruments().reservationTransitions.add(1, { from, to }));

export const recordActivationDelay = (scheduledAt: string, atMs = Date.now()): void =>
  safely(() => {
    const scheduledMs = Date.parse(scheduledAt);
    if (!Number.isFinite(scheduledMs)) return;
    instruments().activationDelay.record(Math.max(0, (atMs - scheduledMs) / 1000));
  });

export const recordActivationResolution = (
  result: string,
  scheduledAt: Date | string,
  path: 'events' | 'rest',
  atMs = Date.now(),
): void =>
  safely(() => {
    const scheduledMs =
      scheduledAt instanceof Date ? scheduledAt.getTime() : Date.parse(scheduledAt);
    if (!Number.isFinite(scheduledMs)) return;
    instruments().activationResolution.record(Math.max(0, (atMs - scheduledMs) / 1000), {
      result,
      path,
    });
  });

export type DegradationCause =
  | 'route_unavailable'
  | 'm7_timeout'
  | 'm7_unavailable'
  | 'm7_bad_response'
  | 'm7_rejected'
  | 'unknown';

export const recordPricingDegradation = (
  operation: 'create' | 'update',
  cause: DegradationCause,
): void => safely(() => instruments().pricingDegradations.add(1, { operation, cause }));

export const recordSchedulerRun = (
  result: 'success' | 'error',
  startMs: number,
  found: number,
): void =>
  safely(() => {
    const current = instruments();
    current.schedulerRuns.add(1, { result });
    current.schedulerDuration.record(seconds(startMs), { result });
    if (found > 0) current.schedulerFound.add(found);
  });

export type CacheOperation = 'get' | 'set' | 'invalidate';
export type CacheResult = 'hit' | 'miss' | 'bypass' | 'error' | 'ok';

export const recordCache = (operation: CacheOperation, result: CacheResult): void =>
  safely(() => instruments().cacheRequests.add(1, { operation, result }));

export const recordRedisOperation = (
  operation: string,
  outcome: 'ok' | 'error',
  startMs: number,
): void =>
  safely(() => instruments().redisDuration.record(seconds(startMs), { operation, outcome }));

export const recordLock = (result: 'acquired' | 'conflict' | 'unavailable' | 'error'): void =>
  safely(() => instruments().lockAcquisitions.add(1, { result }));

export const recordDbOperation = (
  operation: string,
  outcome: 'ok' | 'error',
  startMs: number,
): void => safely(() => instruments().dbDuration.record(seconds(startMs), { operation, outcome }));

export const recordOutboxPublished = (eventType: string): void =>
  safely(() => instruments().outboxPublished.add(1, { event_type: boundedEventType(eventType) }));

export const recordOutboxFailure = (
  eventType: string,
  result: 'retry_scheduled' | 'dead_lettered' | 'dead_letter_failed',
): void =>
  safely(() =>
    instruments().outboxFailures.add(1, { event_type: boundedEventType(eventType), result }),
  );

export const recordOutboxBatch = (startMs: number, size: number): void =>
  safely(() =>
    instruments().outboxBatchDuration.record(seconds(startMs), {
      batch: size === 0 ? 'empty' : 'non_empty',
    }),
  );

export const recordMessagingPublish = (
  destination: 'main' | 'retry' | 'dead_letter',
  eventType: string,
  result: 'confirmed' | 'error',
): void =>
  safely(() =>
    instruments().messagingPublished.add(1, {
      destination,
      event_type: boundedEventType(eventType),
      result,
    }),
  );

export const recordMessagingConsume = (
  eventType: string,
  result: 'ack' | 'retry' | 'dead_letter',
  startMs: number,
): void =>
  safely(() => {
    const attributes: Attributes = { event_type: boundedEventType(eventType), result };
    instruments().messagingConsumed.add(1, attributes);
    instruments().messagingProcessDuration.record(seconds(startMs), attributes);
  });

export const recordInboxResult = (eventType: string, result: string): void =>
  safely(() =>
    instruments().inboxResults.add(1, { event_type: boundedEventType(eventType), result }),
  );

export const dependencyTarget = (baseUrl: string | URL): 'stub' | 'external' => {
  try {
    const host = (typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl).hostname;
    return host.includes('stub') ? 'stub' : 'external';
  } catch {
    return 'external';
  }
};

export const recordDependencyCall = (input: {
  dependency: string;
  operation: string;
  outcome: string;
  target: 'stub' | 'external';
  startMs: number;
}): void =>
  safely(() => {
    const attributes: Attributes = {
      dependency: input.dependency.toLowerCase(),
      operation: input.operation,
      outcome: input.outcome,
      target: input.target,
      transport: 'rest',
    };
    instruments().dependencyRequests.add(1, attributes);
    instruments().dependencyDuration.record(seconds(input.startMs), attributes);
  });
