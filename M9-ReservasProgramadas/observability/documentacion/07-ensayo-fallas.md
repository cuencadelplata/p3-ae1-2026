# 07 · Ensayo controlado de fallas (composición aislada)

Script: `scripts/fault-drill.mjs` · Comando: `npm run obs:fault-drill` (opcional
`-- redis rabbitmq --with-telemetry`).

## Garantías

- Proyecto Compose propio **`m9-fault-drill`** con puertos distintos (API 3100, PostgreSQL
  5532, Redis 6479, RabbitMQ 5772/15772): el Compose habitual (`m9-reservas-programadas`) no se
  detiene ni se modifica.
- Fallas inyectadas con `docker compose stop/start`; **no** hay endpoints públicos de fallas.
- La restauración (`start`) está en un bloque `finally`; al final se elimina solo el proyecto
  aislado y sus propios volúmenes (`m9-fault-drill_*`).
- Resultados: `observability/resultados/fault-drill-<fecha>.json`.

## Qué se mide en cada dependencia (antes / durante / después)

`/health`, `/readiness` y un `POST /reservas` (status, `tarifaEstimada`, código de error).
Con `--with-telemetry`, además se observa en Grafana `m9_dependency_up`, backlog Outbox y
alertas.

| Dependencia | Comportamiento esperado según el código (a confirmar con el ensayo)                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `m7-stub`   | `/readiness` 200; POST 201 con `tarifaEstimada: null`; sube `m9_reservation_pricing_degradations_total{cause="m7_unavailable"}`          |
| `redis`     | `/readiness` 503; GET usa PostgreSQL (`m9_cache_requests_total{result="bypass"}`); PATCH/DELETE 503 `COORDINACION_NO_DISPONIBLE` (locks) |
| `rabbitmq`  | `/readiness` 503; POST 201 (Outbox transaccional); crece `m9_outbox_pending` y su edad; tras recuperar, el backlog drena                 |
| `postgres`  | `/readiness` 503; POST 5xx; `m9_state_collector_up{source="database"}=0` y gauges de backlog **ausentes** (no cero)                      |

## Estado

**Preparado, no ejecutado**: requiere Docker Desktop. No hay resultados registrados todavía.
