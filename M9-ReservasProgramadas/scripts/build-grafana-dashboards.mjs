/**
 * Genera un único dashboard de Grafana (JSON importable) con todas las secciones de M9:
 *   node scripts/build-grafana-dashboards.mjs
 *
 * Nombres de métricas: los de src/observability/metrics.ts traducidos por la ingesta OTLP de
 * Grafana Cloud al formato Prometheus (puntos -> guiones bajos, sufijo de unidad `_seconds`/
 * `_bytes`, `_total` en contadores, `_bucket/_sum/_count` en histogramas). Verificar en
 * Explore -> Metrics con {service_name="m9-reservas"} tras la primera ingesta.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildFunctionalDashboard } from './grafana-rf-dashboard.mjs';

const OUT = path.resolve(import.meta.dirname, '..', 'observability', 'grafana', 'dashboards');
mkdirSync(OUT, { recursive: true });

const PROM = { type: 'prometheus', uid: '${datasource}' };
const LOKI = { type: 'loki', uid: '${loki}' };
const TEMPO = { type: 'tempo', uid: '${tempo}' };
const S = 'service_name="$service",deployment_environment_name=~"$env"';
const BIZ = `${S},m9_route_kind="business"`;

const templating = (extra = []) => ({
  list: [
    {
      name: 'datasource',
      label: 'Métricas (Mimir)',
      type: 'datasource',
      query: 'prometheus',
      current: {},
    },
    { name: 'loki', label: 'Logs (Loki)', type: 'datasource', query: 'loki', current: {} },
    { name: 'tempo', label: 'Trazas (Tempo)', type: 'datasource', query: 'tempo', current: {} },
    {
      name: 'env',
      label: 'Entorno',
      type: 'query',
      datasource: PROM,
      query: {
        query:
          'label_values(http_server_request_duration_seconds_count, deployment_environment_name)',
        refId: 'env',
      },
      includeAll: true,
      allValue: '.*',
      multi: false,
      refresh: 2,
      current: {},
    },
    {
      name: 'service',
      label: 'Servicio',
      type: 'query',
      datasource: PROM,
      query: {
        query: 'label_values(http_server_request_duration_seconds_count, service_name)',
        refId: 'service',
      },
      refresh: 2,
      current: { text: 'm9-reservas', value: 'm9-reservas' },
    },
    ...extra,
  ],
});

let nextId = 1;
const grid = { x: 0, y: 0 };
const place = (w, h) => {
  if (grid.x + w > 24) {
    grid.x = 0;
    grid.y += 8;
  }
  const pos = { x: grid.x, y: grid.y, w, h };
  grid.x += w;
  return pos;
};
const resetGrid = () => {
  grid.x = 0;
  grid.y = 0;
  nextId = 1;
};

const row = (title) => {
  if (grid.x !== 0) grid.y += 8;
  grid.x = 0;
  const panel = {
    id: nextId++,
    type: 'row',
    title,
    collapsed: false,
    gridPos: { x: 0, y: grid.y, w: 24, h: 1 },
    panels: [],
  };
  grid.y += 1;
  return panel;
};

const targets = (queries, ds = PROM) =>
  queries.map(([expr, legend], index) => ({
    refId: String.fromCharCode(65 + index),
    datasource: ds,
    expr,
    legendFormat: legend ?? '__auto',
    range: true,
  }));

const ts = (
  title,
  queries,
  { unit = 'short', w = 12, description = '', stack = false, min } = {},
) => ({
  id: nextId++,
  type: 'timeseries',
  title,
  description,
  datasource: PROM,
  gridPos: place(w, 8),
  targets: targets(queries),
  fieldConfig: {
    defaults: {
      unit,
      ...(min === undefined ? {} : { min }),
      custom: {
        drawStyle: 'line',
        fillOpacity: stack ? 30 : 10,
        stacking: { mode: stack ? 'normal' : 'none' },
        spanNulls: false,
      },
    },
    overrides: [],
  },
  options: {
    legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] },
    tooltip: { mode: 'multi' },
  },
});

const stat = (title, expr, { unit = 'short', w = 6, description = '', thresholds = [] } = {}) => ({
  id: nextId++,
  type: 'stat',
  title,
  description,
  datasource: PROM,
  gridPos: place(w, 8),
  targets: targets([[expr]]).map((target) => ({ ...target, instant: true, range: false })),
  fieldConfig: {
    defaults: {
      unit,
      // Sin datos se muestra "Sin datos" (no 0): distingue ausencia de un cero real.
      noValue: 'Sin datos',
      thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, ...thresholds] },
    },
    overrides: [],
  },
  options: {
    reduceOptions: { calcs: ['lastNotNull'] },
    colorMode: 'background',
    graphMode: 'area',
  },
});

const logs = (title, expr, { w = 24, description = '' } = {}) => ({
  id: nextId++,
  type: 'logs',
  title,
  description,
  datasource: LOKI,
  gridPos: place(w, 8),
  targets: [{ refId: 'A', datasource: LOKI, expr, queryType: 'range' }],
  options: {
    showTime: true,
    wrapLogMessage: true,
    enableLogDetails: true,
    sortOrder: 'Descending',
  },
});

const traces = (title, query, { w = 24, description = '' } = {}) => ({
  id: nextId++,
  type: 'table',
  title,
  description,
  datasource: TEMPO,
  gridPos: place(w, 8),
  targets: [
    { refId: 'A', datasource: TEMPO, queryType: 'traceql', query, limit: 20, tableType: 'traces' },
  ],
});

const q = (quantile, bucket, by = '') =>
  `histogram_quantile(${quantile}, sum by (le${by ? `, ${by}` : ''}) (rate(${bucket}[$__rate_interval])))`;

const dashboard = (uid, title, description, panels, extraVars = []) => ({
  uid,
  title,
  description,
  tags: ['m9', 'reservas', 'ae4', 'opentelemetry'],
  timezone: 'browser',
  schemaVersion: 39,
  version: 1,
  editable: true,
  refresh: '30s',
  time: { from: 'now-1h', to: 'now' },
  templating: templating(extraVars),
  annotations: { list: [] },
  links: [],
  panels,
});

// ---------------------------------------------------------------- General
resetGrid();
const general = dashboard(
  'm9-ae4-general',
  'M9 Reservas · General',
  'Tráfico, latencia, errores, runtime y salud de dependencias de M9. Para comparar con una prueba k6, ajustar el rango de tiempo a la ventana del test e ingresar su RUN_ID.',
  [
    row('Tráfico de negocio (/reservas)'),
    ts(
      'Solicitudes por segundo por ruta y método',
      [
        [
          `sum by (http_route, http_request_method) (rate(http_server_request_duration_seconds_count{${BIZ}}[$__rate_interval]))`,
          '{{http_request_method}} {{http_route}}',
        ],
      ],
      { unit: 'reqps' },
    ),
    ts(
      'Latencia p50 / p95 / p99 (negocio)',
      [
        [q(0.5, `http_server_request_duration_seconds_bucket{${BIZ}}`), 'p50'],
        [q(0.95, `http_server_request_duration_seconds_bucket{${BIZ}}`), 'p95'],
        [q(0.99, `http_server_request_duration_seconds_bucket{${BIZ}}`), 'p99'],
      ],
      { unit: 's' },
    ),
    ts(
      'Latencia p95 por ruta',
      [
        [
          q(
            0.95,
            `http_server_request_duration_seconds_bucket{${BIZ}}`,
            'http_route, http_request_method',
          ),
          '{{http_request_method}} {{http_route}}',
        ],
      ],
      { unit: 's' },
    ),
    ts(
      'Respuestas por clase de estado',
      [
        [
          `sum by (http_response_status_code) (rate(http_server_request_duration_seconds_count{${BIZ}}[$__rate_interval]))`,
          '{{http_response_status_code}}',
        ],
      ],
      { unit: 'reqps', stack: true },
    ),
    stat(
      'Tasa de errores 5xx (5 min)',
      `(sum(rate(http_server_request_duration_seconds_count{${BIZ},http_response_status_code=~"5.."}[5m])) or vector(0)) / sum(rate(http_server_request_duration_seconds_count{${BIZ}}[5m]))`,
      {
        unit: 'percentunit',
        thresholds: [
          { color: 'orange', value: 0.01 },
          { color: 'red', value: 0.05 },
        ],
      },
    ),
    stat('Solicitudes en curso', `sum(http_server_active_requests{${S}})`, {
      thresholds: [{ color: 'orange', value: 20 }],
    }),
    stat(
      'p95 negocio (5 min)',
      `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{${BIZ}}[5m])))`,
      {
        unit: 's',
        thresholds: [
          { color: 'orange', value: 0.3 },
          { color: 'red', value: 0.5 },
        ],
      },
    ),
    stat(
      'Solicitudes negocio (rango)',
      `sum(increase(http_server_request_duration_seconds_count{${BIZ}}[$__range]))`,
    ),
    ts(
      'Health / readiness / docs (separado del negocio)',
      [
        [
          `sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count{${S},m9_route_kind=~"health|docs|static|unmatched"}[$__rate_interval]))`,
          '{{http_route}} {{http_response_status_code}}',
        ],
      ],
      { unit: 'reqps', w: 24 },
    ),
    row('Runtime del proceso Node.js (no host ni contenedor)'),
    ts(
      'CPU del proceso',
      [
        [
          `sum by (cpu_mode) (rate(process_cpu_time_seconds_total{${S}}[$__rate_interval]))`,
          '{{cpu_mode}}',
        ],
      ],
      { unit: 'percentunit', w: 8, stack: true },
    ),
    ts(
      'Memoria RSS y heap V8',
      [
        [`sum(process_memory_usage_bytes{${S}})`, 'RSS'],
        [`sum(v8js_memory_heap_used_bytes{${S}})`, 'heap usado'],
      ],
      { unit: 'bytes', w: 8 },
    ),
    ts(
      'Event loop: utilización y GC p95',
      [
        [`avg(nodejs_eventloop_utilization_ratio{${S}})`, 'utilización event loop'],
        [q(0.95, `v8js_gc_duration_seconds_bucket{${S}}`), 'GC p95 (s)'],
      ],
      { unit: 'short', w: 8 },
    ),
    row('Salud de dependencias (readiness periódico)'),
    stat('PostgreSQL', `max(m9_dependency_up{${S},dependency="postgres"})`, {
      w: 6,
      thresholds: [],
      description: '1 = responde, 0 = caída. "Sin datos" = recolector sin muestras recientes.',
    }),
    stat('Redis', `max(m9_dependency_up{${S},dependency="redis"})`, { w: 6 }),
    stat('RabbitMQ', `max(m9_dependency_up{${S},dependency="rabbitmq"})`, { w: 6 }),
    stat('Recolector de estado', `min(m9_state_collector_up{${S}})`, {
      w: 6,
      description:
        '0 = alguna consulta agregada falló: los paneles de backlog quedan sin datos (no en cero).',
    }),
    row('Logs y correlación con k6'),
    ts('Logs HTTP de la prueba k6 (RUN_ID)', [], { w: 24 }),
    logs('Logs de error de M9', `{service_name="$service"} | severity_text=~"ERROR|WARN"`, {
      description: 'Abrir un log y usar el campo trace_id para saltar a la traza en Tempo.',
    }),
    logs(
      'Logs de la ejecución k6 seleccionada',
      `{service_name="$service"} | correlationId=~"$k6_run.*"`,
      {
        description:
          'k6 envía x-correlation-id = RUN_ID-VU-iteración; filtra solo las solicitudes de esa prueba.',
      },
    ),
  ],
  [
    {
      name: 'k6_run',
      label: 'RUN_ID k6',
      type: 'textbox',
      query: '',
      current: { text: '', value: '' },
    },
  ],
);
// El panel de conteo de logs por RUN_ID usa Loki (métrica derivada de logs).
const k6Panel = general.panels.find(
  (panel) => panel.title === 'Logs HTTP de la prueba k6 (RUN_ID)',
);
k6Panel.datasource = LOKI;
k6Panel.targets = [
  {
    refId: 'A',
    datasource: LOKI,
    expr: 'sum by (statusCode) (count_over_time({service_name="$service"} | message="http_request" | correlationId=~"$k6_run.*" [$__interval]))',
    legendFormat: 'HTTP {{statusCode}}',
    queryType: 'range',
  },
];
k6Panel.description =
  'Solicitudes de la prueba k6 (filtradas por RUN_ID) por código de estado, desde logs estructurados.';

// ---------------------------------------------------------------- Reservas
resetGrid();
const reservas = dashboard(
  'm9-ae4-reservas',
  'M9 Reservas · Negocio y scheduler',
  'Estados, activaciones finales, retrasos del scheduler, degradaciones y errores de negocio.',
  [
    row('Estado actual (consulta agregada periódica)'),
    ts(
      'Reservas por estado',
      [[`sum by (status) (m9_reservations_by_status{${S}})`, '{{status}}']],
      { w: 12 },
    ),
    stat('PROGRAMADA vencidas sin activar', `max(m9_reservations_overdue_pending{${S}})`, {
      thresholds: [{ color: 'orange', value: 1 }],
    }),
    stat('ACTIVANDO estancadas', `max(m9_reservations_stuck_activating{${S}})`, {
      thresholds: [{ color: 'red', value: 1 }],
    }),
    row('Operaciones (contadas tras el commit)'),
    ts(
      'Operaciones por resultado',
      [
        [
          `sum by (operation, result) (increase(m9_reservation_operations_total{${S}}[$__rate_interval]))`,
          '{{operation}} {{result}}',
        ],
      ],
      { stack: true },
    ),
    ts(
      'Rechazos y errores por motivo',
      [
        [
          `sum by (operation, reason) (increase(m9_reservation_operations_total{${S},result!="success"}[$__rate_interval]))`,
          '{{operation}} {{reason}}',
        ],
      ],
      { stack: true },
    ),
    ts(
      'Transiciones de estado confirmadas',
      [
        [
          `sum by (from, to) (increase(m9_reservation_transitions_total{${S}}[$__rate_interval]))`,
          '{{from}} → {{to}}',
        ],
      ],
      { stack: true },
    ),
    ts(
      'Degradaciones de tarifa/ruta (respuesta 2xx sin tarifa)',
      [
        [
          `sum by (operation, cause) (increase(m9_reservation_pricing_degradations_total{${S}}[$__rate_interval]))`,
          '{{operation}} {{cause}}',
        ],
      ],
      { stack: true },
    ),
    row('Activación'),
    ts(
      'Activaciones finales',
      [
        [
          `sum by (to) (increase(m9_reservation_transitions_total{${S},from="ACTIVANDO",to=~"ACTIVADA|FALLIDA"}[$__rate_interval]))`,
          '{{to}}',
        ],
      ],
      { stack: true, w: 8 },
    ),
    stat(
      'Éxito de activación (rango)',
      `sum(increase(m9_reservation_transitions_total{${S},from="ACTIVANDO",to="ACTIVADA"}[$__range])) / sum(increase(m9_reservation_transitions_total{${S},from="ACTIVANDO",to=~"ACTIVADA|FALLIDA"}[$__range]))`,
      { unit: 'percentunit', w: 4, thresholds: [] },
    ),
    ts(
      'Retraso de inicio de activación p50/p95',
      [
        [q(0.5, `m9_reservation_activation_delay_seconds_bucket{${S}}`), 'p50'],
        [q(0.95, `m9_reservation_activation_delay_seconds_bucket{${S}}`), 'p95'],
      ],
      {
        unit: 's',
        w: 6,
        description:
          'Desde la fecha programada hasta el claim PROGRAMADA→ACTIVANDO. No incluye la espera intencional previa.',
      },
    ),
    ts(
      'Resolución final p95 por resultado',
      [
        [
          q(0.95, `m9_reservation_activation_resolution_seconds_bucket{${S}}`, 'result, path'),
          '{{result}} ({{path}})',
        ],
      ],
      { unit: 's', w: 6 },
    ),
    ts(
      'Antigüedad de vencidas y ACTIVANDO',
      [
        [`max(m9_reservations_oldest_overdue_age_seconds{${S}})`, 'PROGRAMADA vencida más vieja'],
        [`max(m9_reservations_oldest_activating_age_seconds{${S}})`, 'ACTIVANDO más vieja'],
      ],
      { unit: 's', w: 24 },
    ),
    row('Scheduler'),
    ts(
      'Ejecuciones por resultado',
      [[`sum by (result) (rate(m9_scheduler_runs_total{${S}}[$__rate_interval]))`, '{{result}}']],
      { unit: 'ops', w: 8 },
    ),
    ts(
      'Duración de ejecución p95 y candidatas',
      [
        [q(0.95, `m9_scheduler_run_duration_seconds_bucket{${S}}`), 'duración p95 (s)'],
        [
          `sum(rate(m9_scheduler_reservations_found_total{${S}}[$__rate_interval]))`,
          'candidatas/s',
        ],
      ],
      { w: 8 },
    ),
    stat(
      'Segundos desde la última ejecución exitosa',
      `time() - max(m9_scheduler_last_success_timestamp_seconds{${S}})`,
      {
        unit: 's',
        w: 8,
        thresholds: [
          { color: 'orange', value: 60 },
          { color: 'red', value: 120 },
        ],
      },
    ),
  ],
);

// ---------------------------------------------------------------- Procesamiento
resetGrid();
const procesamiento = dashboard(
  'm9-ae4-procesamiento',
  'M9 Reservas · Procesamiento asíncrono',
  'Outbox, colas RabbitMQ, retry/DLQ, Inbox, caché Redis, locks, PostgreSQL y clientes M5/M7.',
  [
    row('Outbox transaccional'),
    stat('Pendientes', `max(m9_outbox_pending{${S}})`, {
      thresholds: [{ color: 'orange', value: 50 }],
    }),
    stat('Edad del pendiente más viejo', `max(m9_outbox_oldest_pending_age_seconds{${S}})`, {
      unit: 's',
      thresholds: [
        { color: 'orange', value: 30 },
        { color: 'red', value: 60 },
      ],
    }),
    stat('FAILED', `max(m9_outbox_failed{${S}})`, { thresholds: [{ color: 'red', value: 1 }] }),
    stat('Publicados (rango)', `sum(increase(m9_outbox_published_total{${S}}[$__range]))`),
    ts(
      'Publicados por tipo de evento',
      [
        [
          `sum by (event_type) (rate(m9_outbox_published_total{${S}}[$__rate_interval]))`,
          '{{event_type}}',
        ],
      ],
      { unit: 'ops' },
    ),
    ts(
      'Fallas de publicación (retry / DLQ)',
      [
        [
          `sum by (result) (increase(m9_outbox_failures_total{${S}}[$__rate_interval]))`,
          '{{result}}',
        ],
      ],
      { stack: true },
    ),
    ts(
      'Duración p95 de los ciclos de Outbox',
      [[q(0.95, `m9_outbox_batch_duration_seconds_bucket{${S}}`, 'batch'), '{{batch}}']],
      { unit: 's', w: 24 },
    ),
    row('RabbitMQ e Inbox'),
    ts(
      'Mensajes en cola por rol (profundidad real)',
      [
        [
          `sum by (queue, queue_role) (m9_rabbitmq_queue_messages{${S}})`,
          '{{queue_role}} · {{queue}}',
        ],
      ],
      { w: 8 },
    ),
    ts(
      'Consumidores por cola',
      [[`sum by (queue) (m9_rabbitmq_queue_consumers{${S}})`, '{{queue}}']],
      { w: 8 },
    ),
    stat('Mensajes en DLQ', `max(m9_rabbitmq_queue_messages{${S},queue_role="dead_letter"})`, {
      w: 8,
      thresholds: [{ color: 'red', value: 1 }],
    }),
    ts(
      'Publicaciones AMQP por destino y confirmación',
      [
        [
          `sum by (destination, result) (rate(m9_messaging_published_total{${S}}[$__rate_interval]))`,
          '{{destination}} {{result}}',
        ],
      ],
      { unit: 'ops', w: 8 },
    ),
    ts(
      'Consumo por desenlace (ack / retry / dead_letter)',
      [
        [
          `sum by (result) (rate(m9_messaging_consumed_total{${S}}[$__rate_interval]))`,
          '{{result}}',
        ],
      ],
      { unit: 'ops', w: 8 },
    ),
    ts(
      'Inbox: PROCESSED / DUPLICATE / IGNORED',
      [
        [
          `sum by (result) (increase(m9_inbox_results_total{${S}}[$__rate_interval]))`,
          '{{result}}',
        ],
      ],
      { w: 8, stack: true },
    ),
    ts(
      'Duración p95 del procesamiento de mensajes',
      [
        [
          q(0.95, `m9_messaging_process_duration_seconds_bucket{${S}}`, 'event_type, result'),
          '{{event_type}} {{result}}',
        ],
      ],
      { unit: 's', w: 24 },
    ),
    row('Caché Redis y locks'),
    ts(
      'Caché por resultado (bypass = Redis caído)',
      [
        [
          `sum by (operation, result) (rate(m9_cache_requests_total{${S}}[$__rate_interval]))`,
          '{{operation}} {{result}}',
        ],
      ],
      { unit: 'ops', w: 8 },
    ),
    stat(
      'Hit ratio de lecturas',
      `sum(rate(m9_cache_requests_total{${S},operation="get",result="hit"}[5m])) / sum(rate(m9_cache_requests_total{${S},operation="get",result=~"hit|miss"}[5m]))`,
      { unit: 'percentunit', w: 4 },
    ),
    ts(
      'Locks: adquisición / conflicto / no disponible',
      [
        [
          `sum by (result) (increase(m9_lock_acquisitions_total{${S}}[$__rate_interval]))`,
          '{{result}}',
        ],
      ],
      { w: 6, stack: true },
    ),
    ts(
      'Duración Redis p95 por operación',
      [[q(0.95, `m9_redis_operation_duration_seconds_bucket{${S}}`, 'operation'), '{{operation}}']],
      { unit: 's', w: 6 },
    ),
    row('PostgreSQL (operaciones de repositorio)'),
    ts(
      'Duración p95 por operación',
      [[q(0.95, `m9_db_operation_duration_seconds_bucket{${S}}`, 'operation'), '{{operation}}']],
      { unit: 's' },
    ),
    ts(
      'Errores por operación',
      [
        [
          `sum by (operation) (rate(m9_db_operation_duration_seconds_count{${S},outcome="error"}[$__rate_interval]))`,
          '{{operation}}',
        ],
      ],
      { unit: 'ops' },
    ),
    row('Dependencias M5 / M7 (REST)'),
    ts(
      'Llamadas por dependencia y resultado',
      [
        [
          `sum by (dependency, operation, outcome, target) (rate(m9_dependency_requests_total{${S}}[$__rate_interval]))`,
          '{{dependency}} {{operation}} {{outcome}} ({{target}})',
        ],
      ],
      { unit: 'ops' },
    ),
    ts(
      'Duración p95 por dependencia',
      [
        [
          q(0.95, `m9_dependency_request_duration_seconds_bucket{${S}}`, 'dependency, operation'),
          '{{dependency}} {{operation}}',
        ],
      ],
      { unit: 's' },
    ),
    row('Trazas'),
    traces(
      'Trazas recientes con error',
      '{ resource.service.name = "$service" && status = error }',
      { w: 12 },
    ),
    traces(
      'Trazas de publicación Outbox / consumo',
      '{ resource.service.name =~ "m9-reservas|m5-stub" && (name =~ "publish.*" || name =~ "process.*") }',
      { w: 12 },
    ),
  ],
);

const unified = buildFunctionalDashboard({
  sections: [general, reservas, procesamiento],
  variables: general.templating.list,
  stat,
  ts,
  logs,
  traces,
  q,
  S,
  BIZ,
});
const file = 'm9-observabilidad.json';
writeFileSync(path.join(OUT, file), `${JSON.stringify(unified, null, 2)}\n`);
console.log(
  `dashboard ${unified.metadata.name} -> observability/grafana/dashboards/${file} (${unified.spec.layout.spec.tabs.length} pestañas, ${Object.keys(unified.spec.elements).length} paneles)`,
);
