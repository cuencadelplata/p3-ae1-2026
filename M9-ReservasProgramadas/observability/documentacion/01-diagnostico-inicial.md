# 01 · Diagnóstico inicial (línea base antes de AE4)

## Punto de partida

- Rama base: `ae2/parra-ingaramo-ignacio` (versión 2.0.0 de M9). La rama de trabajo AE4 es
  `ae4/m9-observabilidad`, creada desde esa base. `M9-ReservasProgramadas` (rama local
  anterior) no tiene Redis, RabbitMQ ni Outbox worker, por eso no se usó.
- Stack: Node.js ≥22 (local: 24.14.1), TypeScript ESM/NodeNext, Express 5.2.1,
  Prisma 6.12.0, PostgreSQL 17, Redis 7.4, RabbitMQ 4.1, Docker Compose con stubs M5/M7.
- Compose: `DISPATCH_MODE=events`, `ROUTE_RESOLVER_MODE=stub`, scheduler cada 5 s y polling
  Outbox cada 5 s. Fuera de Compose: scheduler cada 30 s y resolución de ruta `blocked`.

## Observabilidad existente

| Elemento             | Estado previo                                                                       |
| -------------------- | ----------------------------------------------------------------------------------- |
| Logs                 | JSON por stdout (`src/logging/logger.ts`) con `correlationId` por AsyncLocalStorage |
| Correlación          | `x-correlation-id` aceptado **sin validar** (longitud/caracteres)                   |
| Log HTTP             | Sin duración; usaba `originalUrl` (UUID y query string en el log)                   |
| Salud                | `/health` (proceso) y `/readiness` (PostgreSQL/Redis/RabbitMQ)                      |
| Métricas / trazas    | No existían (sin OpenTelemetry, sin endpoint de métricas)                           |
| Grafana / Alloy / k6 | No existían                                                                         |

## Verificaciones antes de modificar (línea base)

| Comando                | Resultado                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | OK                                                                                                                                                                                                         |
| `npm run lint`         | OK                                                                                                                                                                                                         |
| `npm test`             | OK — 62 tests en 15 archivos                                                                                                                                                                               |
| `npm run format:check` | **Falla preexistente**: 97 archivos. Causa: `core.autocrlf=true` en Windows deja CRLF en el working tree y Prettier espera LF. Con `--end-of-line auto` pasa todo. No se modificó la configuración global. |

No había línea base instrumentada: **no existe comparación antes/después de rendimiento**.
Las primeras mediciones de k6 serán la línea base.

## Riesgos a medir (hipótesis, no cuellos de botella demostrados)

1. `GET /reservas` sin paginación; además `DELETE` es lógico, así que el listado crece.
2. Scheduler: lote de 100 con `Promise.allSettled` (picos de concurrencia contra Redis/PostgreSQL).
3. Outbox: lote de 100 con publicación **secuencial** y `waitForConfirms` por mensaje.
4. Consumidor RabbitMQ con `prefetch(1)`.
5. Degradación silenciosa: crear/modificar responde 2xx sin tarifa si falla la ruta o M7.
6. Redis caído: la caché degrada a PostgreSQL, pero los locks rechazan operaciones (503).

Ninguna de estas decisiones se cambió en AE4: primero hay que medirlas.
