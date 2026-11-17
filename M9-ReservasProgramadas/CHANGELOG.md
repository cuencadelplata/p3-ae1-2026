# Changelog

## 2.0.0 — AE2

- PostgreSQL/Prisma como fuente de verdad y migraciones reproducibles.
- Idempotency-Key de despacho durable.
- Redis cache-aside, TTL, invalidación y lock distribuido.
- RabbitMQ con dos flujos de negocio, publisher confirms, retry y DLQ.
- Transactional Outbox e Inbox durable/idempotente.
- Readiness para PostgreSQL, Redis y RabbitMQ; logs JSON correlacionados.
- Pruebas de persistencia, duplicados, recuperación y concurrencia.
- Arquitectura, ownership, catálogo de eventos, ADR, Portafolio y Bitácora.

## 1.x — AE1

- CRUD REST de reservas, scheduler, OpenAPI/Swagger y UI.
- Integración inicial M5/M7 y persistencia en memoria.
- Dockerfile, Compose y pruebas unitarias/integración/E2E.
