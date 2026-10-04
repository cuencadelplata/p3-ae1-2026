# Plan de issues AE2

Estado: `BLOCKED_GITHUB_AUTH`. GitHub CLI no está instalado en el entorno actual; no se
crearon issues ficticios.

## Persistir reservas con PostgreSQL/Prisma

Aceptación: migración desde cero, repositorio productivo Prisma, seed no sensible,
readiness PostgreSQL y datos después de reinicio.

## Implementar Outbox/Inbox durable

Aceptación: operación + Outbox atómicas, publisher confirm, Inbox `eventId` único y prueba
de duplicado concurrente.

## Incorporar dos flujos RabbitMQ

Aceptación: ready-for-dispatch y assigned/failed, retries con TTL, límite y DLQ; catálogo
documentado.

## Demostrar concurrencia multiinstancia

Aceptación: dos clientes independientes compiten por cancelación/activación y solo una
transición gana.

## Cerrar documentación y release 2.0.0

Aceptación: README, OpenAPI, ADR, diagramas, Portafolio, Bitácora, evidencias, tag y release
sin sobrescribir `v1.0.0`.
