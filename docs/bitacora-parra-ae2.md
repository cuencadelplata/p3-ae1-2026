# Bitácora individual — Ignacio Parra — AE2

## Trabajo previo a consolidación documental

- Tarea: revisar M9 heredado e integrar contratos M5/M7.
- Problema: rutas antiguas no coincidían con OpenAPI externos.
- Decisión: adapters explícitos, timeout y stubs contractuales.
- Resultado: flujo REST verificable y errores diferenciados.
- Evidencia: auditoría OpenAPI y tests de clientes.
- Reflexión: integrar no es copiar DTOs; es proteger el dominio con un adapter.

## Trabajo previo a consolidación documental

- Tarea: introducir Redis y RabbitMQ base.
- Problema: lock local y caché de proceso no sirven entre instancias.
- Decisión: cache-aside, TTL, invalidación y lock Redis con token.
- Resultado: coordinación compartida y pruebas de infraestructura preparadas.
- Evidencia: código Redis y tests.
- Reflexión: el lock reduce carreras, pero no sustituye una condición atómica durable.

## 4 de octubre de 2026 — cierre de persistencia

- Tarea: reemplazar InMemory en producción.
- Problema: reinicios y doble activación.
- Decisión: Prisma/PostgreSQL, migración y update condicional.
- Resultado: reservas, claves y eventos sobreviven al proceso.
- Evidencia: schema, migración y test de reconexión.
- Reflexión: ownership se demuestra tanto con el modelo como con la ausencia de SQL cruzado.

## 4 de octubre de 2026 — cierre de mensajería

- Tarea: implementar dos flujos RabbitMQ útiles.
- Problema: dual-write, reintentos y duplicados concurrentes.
- Decisión: Outbox, Inbox, publisher confirms, retry TTL y DLQ.
- Resultado: flujo local M9↔M5 stub preparado y transaccional.
- Evidencia: catálogo, arquitectura y pruebas de infraestructura.
- Reflexión: la entrega al menos una vez obliga a diseñar idempotencia desde el comienzo.

## 4 de octubre de 2026 — validación

- Tarea: ejecutar checks y registrar evidencia honesta.
- Problema: Docker Desktop apagado.
- Decisión: continuar con typecheck/lint/build/tests/coverage/docs y marcar solo Docker como
  bloqueado.
- Resultado: controles no Docker ejecutados; E2E/infra pendientes.
- Evidencia: `testing-evidence.md`.
- Reflexión: reproducibilidad incluye reconocer qué no fue realmente ejecutado.
