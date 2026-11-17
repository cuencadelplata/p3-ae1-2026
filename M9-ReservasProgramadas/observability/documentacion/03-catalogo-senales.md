# 03 · Catálogo de señales

Definición: `src/observability/metrics.ts`. Nombre OTel → nombre esperado en Grafana Cloud
(traducción OTLP→Prometheus: `.`→`_`, sufijo `_seconds`/`_bytes` por unidad, `_total` en
contadores, `_bucket/_sum/_count` en histogramas). Todas las series llevan además
`service_name` y `deployment_environment_name` (agregadas por Alloy).
**Pendiente de verificación externa**: confirmar los nombres en _Explore → Metrics_ tras la
primera ingesta; `npm run obs:dashboards:check` asegura que dashboards y alertas usan exactamente
este catálogo.

Reglas: duraciones en segundos; etiquetas de cardinalidad acotada; **ningún UUID, ruta concreta
ni query string como etiqueta**. Los gauges de estado sin muestra reciente quedan **ausentes**
(“Sin datos”), nunca en un cero falso.

## HTTP (`src/observability/http-telemetry.ts`)

| Métrica (Prometheus)                   | Tipo       | Unidad | Etiquetas                                                                         | Se actualiza               | Significado                                                        |
| -------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `http_server_request_duration_seconds` | histograma | s      | `http_request_method`, `http_route`, `http_response_status_code`, `m9_route_kind` | al terminar cada respuesta | Latencia; `_count` = tráfico; p50/p95/p99 con `histogram_quantile` |
| `http_server_active_requests`          | updown     | —      | `http_request_method`                                                             | inicio/fin de request      | Solicitudes en curso                                               |

`m9_route_kind`: `business` (/reservas), `health` (/health, /readiness), `docs`, `static`,
`unmatched` (404 de rutas inexistentes, agrupadas). Rutas: `/reservas`, `/reservas/:id`.
Errores 5xx = `http_response_status_code=~"5.."`.

## Runtime del proceso Node.js

| Métrica                                                                                                                                | Fuente                         | Significado                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `process_cpu_time_seconds_total{cpu_mode}`                                                                                             | propio                         | CPU user/system del **proceso** (no host ni contenedor)                                             |
| `process_memory_usage_bytes`                                                                                                           | propio                         | RSS del proceso                                                                                     |
| `v8js_memory_heap_used_bytes`, `v8js_gc_duration_seconds`, `nodejs_eventloop_utilization_ratio`, `nodejs_eventloop_time_seconds_total` | `instrumentation-runtime-node` | Heap V8, GC, utilización y tiempo del event loop (verificado con `npm run telemetry:verify-export`) |

## Reservas (servicio, repositorio, Inbox)

| Métrica                                         | Tipo       | Etiquetas                                                                                                   | Se actualiza                          | Significado                                                                  |
| ----------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `m9_reservation_operations_total`               | contador   | `operation` (create/update/cancel), `result` (success/rejected/error), `reason` (código AppError)           | tras el commit del repositorio        | Efectos confirmados; un rechazo nunca cuenta como éxito                      |
| `m9_reservation_transitions_total`              | contador   | `from`, `to` (`NONE` para creación)                                                                         | tras `$transaction` con `count>0`     | Transiciones efectivamente confirmadas; duplicados y rollback no cuentan     |
| `m9_reservation_activation_delay_seconds`       | histograma | —                                                                                                           | claim PROGRAMADA→ACTIVANDO confirmado | Retraso entre `scheduledAt` y el inicio real (excluye la espera intencional) |
| `m9_reservation_activation_resolution_seconds`  | histograma | `result` (ACTIVADA/FALLIDA), `path` (events/rest)                                                           | Inbox PROCESSED o resultado REST      | Desde `scheduledAt` hasta el estado final                                    |
| `m9_reservation_pricing_degradations_total`     | contador   | `operation`, `cause` (route_unavailable, m7_timeout, m7_unavailable, m7_bad_response, m7_rejected, unknown) | tras persistir la reserva sin tarifa  | Degradación visible aunque HTTP responda 2xx                                 |
| `m9_reservations_by_status{status}`             | gauge      | `status`                                                                                                    | recolector agregado (15 s)            | Reservas actuales por estado                                                 |
| `m9_reservations_overdue_pending`               | gauge      | —                                                                                                           | recolector                            | PROGRAMADA con fecha vencida aún no activadas                                |
| `m9_reservations_oldest_overdue_age_seconds`    | gauge      | —                                                                                                           | recolector                            | Antigüedad de la vencida más vieja (0 si no hay)                             |
| `m9_reservations_stuck_activating`              | gauge      | —                                                                                                           | recolector                            | ACTIVANDO sin cambios > `OTEL_STUCK_ACTIVATION_THRESHOLD_SECONDS` (120 s)    |
| `m9_reservations_oldest_activating_age_seconds` | gauge      | —                                                                                                           | recolector                            | Antigüedad de la ACTIVANDO más vieja                                         |

## Scheduler (`src/jobs/reservas.scheduler.ts`)

| Métrica                                       | Tipo       | Etiquetas | Significado                                                                     |
| --------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------- |
| `m9_scheduler_runs_total`                     | contador   | `result`  | Ejecuciones exitosas/con error                                                  |
| `m9_scheduler_run_duration_seconds`           | histograma | `result`  | Duración de un lote                                                             |
| `m9_scheduler_reservations_found_total`       | contador   | —         | Candidatas (PROGRAMADA vencida o ACTIVANDO)                                     |
| `m9_scheduler_last_success_timestamp_seconds` | gauge      | —         | Unix time de la última ejecución exitosa (`time() - x` = segundos sin progreso) |

En modo `events` el claim deja la reserva en ACTIVANDO: **la activación final se mide en el
Inbox**, no con el contador `activadas` del scheduler.

## Redis (caché y locks)

| Métrica                               | Tipo       | Etiquetas                                                                                   | Significado                                                            |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `m9_cache_requests_total`             | contador   | `operation` (get/set/invalidate), `result` (hit/miss/**bypass**/error/ok)                   | `bypass` = Redis no disponible (degradado a PostgreSQL); no es un miss |
| `m9_redis_operation_duration_seconds` | histograma | `operation` (cache.get, cache.set, cache.invalidate, lock.acquire, lock.release), `outcome` | Latencia y errores por operación                                       |
| `m9_lock_acquisitions_total`          | contador   | `result` (acquired/conflict/unavailable/error)                                              | `conflict` → 409; `unavailable` → 503                                  |

## PostgreSQL / Prisma

| Métrica                            | Tipo       | Etiquetas                                                                                                                     | Significado                                                                            |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `m9_db_operation_duration_seconds` | histograma | `operation` (reservation.create, reservation.change_status, outbox.find_pending, inbox.process_dispatch_result, …), `outcome` | Duración de operaciones y transacciones completas; `_count{outcome="error"}` = errores |

Sin métricas por texto SQL. Métricas internas de PostgreSQL (conexiones, locks, vacuum)
quedan **fuera de alcance**: requerirían un exporter/integración separado.

## Outbox

| Métrica                                                                         | Tipo       | Etiquetas                                                                 | Significado                                                  |
| ------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `m9_outbox_published_total`                                                     | contador   | `event_type`                                                              | Publicados con confirmación del broker y marcados PUBLISHED  |
| `m9_outbox_failures_total`                                                      | contador   | `event_type`, `result` (retry_scheduled/dead_lettered/dead_letter_failed) | Reintentos y fallidos                                        |
| `m9_outbox_batch_duration_seconds`                                              | histograma | `batch` (empty/non_empty)                                                 | Duración de un ciclo                                         |
| `m9_outbox_pending`, `m9_outbox_oldest_pending_age_seconds`, `m9_outbox_failed` | gauges     | —                                                                         | Backlog por COUNT/MIN agregado; ausente si la consulta falla |

`event_type` pertenece a una lista cerrada; valores externos desconocidos → `unknown`.

## RabbitMQ e Inbox

| Métrica                                 | Tipo       | Etiquetas                                                                        | Significado                                                     |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `m9_messaging_published_total`          | contador   | `destination` (main/retry/dead_letter), `event_type`, `result` (confirmed/error) | Publicaciones AMQP                                              |
| `m9_messaging_consumed_total`           | contador   | `event_type`, `result` (ack/retry/dead_letter)                                   | Desenlace del consumo                                           |
| `m9_messaging_process_duration_seconds` | histograma | ídem                                                                             | Duración del procesamiento                                      |
| `m9_inbox_results_total`                | contador   | `event_type`, `result` (PROCESSED/DUPLICATE/IGNORED)                             | Idempotencia del Inbox                                          |
| `m9_rabbitmq_queue_messages`            | gauge      | `queue`, `queue_role` (main/retry/dead_letter)                                   | **Profundidad real** según RabbitMQ (`checkQueue.messageCount`) |
| `m9_rabbitmq_queue_consumers`           | gauge      | `queue`, `queue_role`                                                            | Consumidores activos                                            |

Limitación: `checkQueue` informa mensajes _listos_; no separa ready/unacked como el plugin
Prometheus de RabbitMQ (descartado por la decisión de no usar Prometheus). Con `prefetch(1)`,
como máximo hay un mensaje sin confirmar por consumidor.

## Dependencias M5 / M7 y salud

| Métrica                                  | Tipo       | Etiquetas                                                                                                                                                                                          | Significado                                                               |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `m9_dependency_requests_total`           | contador   | `dependency` (m5/m7), `operation` (create_request, get_request, cancel_request, estimate), `outcome` (success/http_4xx/http_5xx/timeout/unavailable), `target` (stub/external), `transport` (rest) | Llamadas REST                                                             |
| `m9_dependency_request_duration_seconds` | histograma | ídem                                                                                                                                                                                               | Latencia                                                                  |
| `m9_dependency_up{dependency}`           | gauge      | postgres/redis/rabbitmq                                                                                                                                                                            | 1/0 según readiness periódico                                             |
| `m9_state_collector_up{source}`          | gauge      | database/rabbitmq/dependencies                                                                                                                                                                     | 0 = la consulta agregada falló (los gauges de esa fuente quedan ausentes) |

El transporte por eventos hacia M5 se observa con las métricas de mensajería, no con estas.

## Trazas (spans principales)

| Span                                           | Tipo                                                     | Dónde                                             |
| ---------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `GET /reservas/:id`, `POST /reservas`, …       | SERVER                                                   | middleware HTTP (continúa `traceparent` entrante) |
| `ReservaService.create/update/cancel/get/list` | INTERNAL                                                 | servicio                                          |
| `db reservation.create`, … + spans `prisma:*`  | INTERNAL / CLIENT                                        | repositorios + `@prisma/instrumentation`          |
| `GET` (cliente)                                | CLIENT                                                   | undici → M5/M7                                    |
| `scheduler.run` → `reservation.activate`       | INTERNAL (traza nueva)                                   | scheduler                                         |
| `outbox.process_batch`                         | INTERNAL (traza nueva)                                   | worker Outbox                                     |
| `publish <event_type>`                         | PRODUCER (hijo del contexto persistido + enlace al lote) | Outbox                                            |
| `process <event_type>`                         | CONSUMER (hijo del `traceparent` AMQP)                   | consumidor M9 / m5-stub                           |

Atributos permitidos en spans: `m9.correlation_id`, `m9.reservation_id`, `messaging.message.id`.
Errores: solo `error.type` (nombre), nunca mensajes con datos de clientes.

## Logs

Campos JSON: `timestamp`, `level`, `message`, `service`, `environment`, `trace_id`, `span_id`,
`correlationId` y campos de contexto controlados (`reservaId`, `eventId`, `component`, …).
`http_request` agrega `method`, `path` (ruta normalizada), `routeKind`, `statusCode`,
`durationMs`. Redacción (`src/observability/redaction.ts`): `authorization`, tokens,
contraseñas, cookies, `body`, origen/destino/direcciones/coordenadas → `[REDACTED]`; URLs con
credenciales → `scheme://[REDACTED]@host`. En Loki los campos van como _structured metadata_;
los labels indexados son solo los de recurso (`service_name`, etc.).
