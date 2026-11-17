# 02 · Arquitectura de observabilidad

## Recorrido de cada señal (una sola vía por señal)

| Señal      | Origen                                             | Transporte                       | Recolector                      | Destino en Grafana Cloud |
| ---------- | -------------------------------------------------- | -------------------------------- | ------------------------------- | ------------------------ |
| Trazas     | SDK OpenTelemetry en M9 / m5-stub / m7-stub        | OTLP/HTTP `:4318/v1/traces`      | Alloy (`otelcol.receiver.otlp`) | Tempo                    |
| Métricas   | SDK OpenTelemetry (push periódico cada 15 s)       | OTLP/HTTP `:4318/v1/metrics`     | Alloy                           | Mimir (consultas PromQL) |
| Logs       | `log()` emite JSON a stdout **y** un registro OTLP | OTLP/HTTP `:4318/v1/logs`        | Alloy                           | Loki                     |
| Pruebas k6 | k6 en esta PC                                      | `k6 cloud run --local-execution` | —                               | Grafana Cloud k6         |

- **Sin Prometheus**: no hay endpoint `/metrics`, ni `prom-client`, ni plugin Prometheus de
  RabbitMQ, ni exporter de PostgreSQL. Grafana Cloud guarda las métricas en Mimir y se
  consultan con PromQL: es solo el lenguaje de consulta.
- **Logs**: stdout queda para `docker logs` local; la única ingesta a Loki es OTLP, así no hay
  duplicados ni hace falta montar el socket de Docker en Alloy.
- **Alloy** (`observability/alloy/config.alloy`): receptor OTLP → `memory_limiter` → `transform`
  (copia `service.name` y `deployment.environment.name` a cada punto de métrica para filtrar
  en dashboards) → `batch` → `otlphttp` con Basic Auth (Instance ID + token de solo escritura).

## Inicialización (ESM)

`src/observability/register.ts` es el **primer import** de `server.ts` y de los stubs. En ESM los
imports se evalúan en orden, así que los proveedores globales (traces, metrics, logs, contexto y
propagador W3C) existen antes de que cualquier módulo cree un tracer o un meter.
No se usa `@opentelemetry/sdk-node` porque arrastra `exporter-prometheus`; se arma el SDK con
`sdk-trace`, `sdk-metrics`, `sdk-logs` y exportadores OTLP/HTTP (versiones exactas en
`package.json`, requieren Node ≥22.15).

### Compatibilidad real verificada (no se asumió cobertura automática)

| Componente                | Decisión                                                              | Motivo                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Express 5 (servidor HTTP) | Middleware propio `http-telemetry.ts` (span SERVER + métricas)        | `instrumentation-express` declara soporte `>=4 <6`, pero en ESM la auto-instrumentación necesita hooks de carga (`--import` + `import-in-the-middle`). El middleware propio es determinista, testeable con supertest y normaliza rutas sin UUID                                                                                                                |
| fetch → M5/M7             | `@opentelemetry/instrumentation-undici`                               | Usa `diagnostics_channel` (funciona en ESM sin parches); crea span cliente e inyecta `traceparent`                                                                                                                                                                                                                                                             |
| Prisma 6.12               | `@prisma/instrumentation@6.12.0` + spans de repositorio (`measureDb`) | Spans de consulta con SQL parametrizado (sin valores); métricas por operación lógica, nunca por texto SQL                                                                                                                                                                                                                                                      |
| redis 6 / amqplib 2       | Spans y métricas manuales                                             | Las contrib declaran soporte (`redis <7`, `amqplib <3`), pero también dependen de hooks de carga en ESM y, en AMQP, propagarían el contexto _activo al publicar_: el Outbox necesita el contexto _persistido al crear el evento_. Lo manual controla esa propagación y evita spans duplicados. Se pueden incorporar más adelante si se valida que no dupliquen |
| Runtime                   | `@opentelemetry/instrumentation-runtime-node`                         | Event loop, GC y heap V8 del proceso                                                                                                                                                                                                                                                                                                                           |

## Contexto distribuido

- **HTTP**: el middleware extrae `traceparent` entrante; undici lo inyecta en llamadas salientes.
  El `correlationId` se mantiene (validado: máx. 128 caracteres `[A-Za-z0-9._:-]`).
- **Outbox**: al crear el evento, dentro de la misma transacción, se guarda el contexto W3C en la
  columna nueva `outbox_events.trace_context` (migración aditiva y nullable
  `20261116000000_ae4_outbox_trace_context`). Al publicar —aunque sea otro proceso o después de
  un reinicio— el span PRODUCER se crea como **hijo del contexto guardado** y con un **enlace** al
  ciclo `outbox.process_batch`. Eventos previos a AE4 (`NULL`) inician una traza nueva.
- **AMQP**: el publicador inyecta `traceparent` en los headers; el consumidor crea un span
  CONSUMER hijo de ese contexto. El reintento copia los headers originales y el dead-letter de
  RabbitMQ también los conserva.
- **Inbox → seguimiento**: el evento `reservation.activated/failed` se crea dentro del span
  CONSUMER, así que su Outbox guarda ese contexto y la traza continúa.
- **Scheduler**: trabajo diferido. Cada ejecución es una **traza nueva** (`scheduler.run`); no se
  mantiene ningún span abierto desde la creación hasta la fecha programada.
- **Stubs**: `m5-stub` y `m7-stub` se identifican con su propio `service.name`. No se afirma una
  traza distribuida completa de los módulos M5/M7 reales (no están instrumentados aquí).

## Muestreo, intervalos, costo y volumen

| Parámetro                          | Valor demo                        | Efecto                                                                                                                                  |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_TRACES_SAMPLER_RATIO`        | `1` (100 %) con `ParentBased`     | Toda traza visible en la demo. En carga sostenida bajar a 0.1–0.25: el volumen de Tempo escala linealmente con las solicitudes          |
| `OTEL_METRIC_EXPORT_INTERVAL_MS`   | `15000`                           | Las series activas no dependen del intervalo, pero sí la cantidad de muestras (≈ 4/min por serie). 15 s alcanza para alertas de 1–5 min |
| `OTEL_STATE_COLLECTOR_INTERVAL_MS` | `15000`                           | 6 consultas COUNT/MIN agregadas cada 15 s + 3 `checkQueue`                                                                              |
| Etiquetas                          | Cardinalidad acotada              | Rutas normalizadas, tipos de evento de una lista cerrada, sin UUID: el número de series no crece con los datos                          |
| Logs                               | Un registro por request + eventos | En carga alta es la señal más voluminosa; los atributos van como structured metadata                                                    |

## Robustez

- Telemetría **apagada por defecto** (`OTEL_ENABLED=false`) y siempre apagada en `NODE_ENV=test`.
- Toda medición pasa por `safely()`: un error de telemetría no interrumpe una reserva.
- Exportadores con timeout (`OTEL_EXPORT_TIMEOUT_MS`) y cierre con plazo acotado
  (`OTEL_SHUTDOWN_TIMEOUT_MS`): un Alloy caído no bloquea la salida del proceso.
- Gauges observables con temporalidad DELTA: si el recolector falla, la serie **desaparece** en
  lugar de repetir el último valor (con temporalidad acumulativa el SDK reexporta el último dato).
