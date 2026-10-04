# Progreso AE2 — M9

Fecha de consolidación: 4 de octubre de 2026. Branch: `M9-AE2-Parra`.

## Implementado

- PostgreSQL/Prisma como repositorio productivo, migración y seed ficticio.
- Persistencia de reserva, referencias externas e Idempotency-Key.
- Outbox transaccional, worker, publisher confirm, backoff y estado de fallo.
- Inbox transaccional con PK `eventId` y transición condicional.
- Dos flujos RabbitMQ locales: ready-for-dispatch y assigned/failed.
- Retry queue con TTL y DLQ; límites configurables.
- Redis cache-aside/TTL/invalidation y lock con token.
- Readiness PostgreSQL/Redis/RabbitMQ y logs JSON correlacionados.
- Compose con M9, PostgreSQL, Redis, RabbitMQ y stubs M5/M7.
- OpenAPI/Swagger 2.0.0 y documentación AE2.

## Validación observada

- Typecheck, lint, build y tests normales: PASS.
- Coverage: PASS de thresholds; consultar `testing-evidence.md` para cifras reales.
- Compose config: PASS.
- Infraestructura, imagen y E2E: `BLOCKED_DOCKER_DAEMON`.

## Bloqueos externos

- `PENDIENTE_CONFIRMAR_BASE_AE1`.
- Contratos definitivos M1, M4 y eventos/política de selección M5.
- QR/PDF owner M8: `PENDIENTE_CONFIRMACION_ACADEMICA`.
- Issues/release/registry requieren CLI o autenticación.

No se incluyen cloud, HA, Grafana/Prometheus, Circuit Breaker ni CI/CD completo porque son
alcance AE4.
