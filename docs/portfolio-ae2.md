# Portafolio individual AE2 — Ignacio Parra

## Trabajo previo a consolidación documental

- Objetivo: integrar M5/M7 y preparar la evolución distribuida.
- Cambio: adapters REST, timeouts, Redis, RabbitMQ base, OpenAPI y tests.
- Problema: contratos externos incompletos.
- Decisión: usar puertos/adapters y stubs locales explícitos, sin inventar ownership.
- Evidencia: historial observable y `openapi-integration-audit.md`.
- Aprendizaje: un stub permite demostrar integración, pero no reemplaza un contrato
  acordado.

## Consolidación AE2 — persistencia y consistencia

- Objetivo: eliminar InMemory de ejecución normal.
- Cambio: PostgreSQL/Prisma, migración, seed, repositorio y key durable.
- Problema: coordinar procesos sin depender solo del lock Redis.
- Decisión: updates condicionales por estado y transacciones SQL.
- Evidencia: schema, migración y pruebas de dos clientes.
- Aprendizaje: Redis coordina; la base garantiza el estado final.

## Consolidación AE2 — mensajería confiable

- Objetivo: convertir RabbitMQ en flujo funcional.
- Cambio: eventos de activación/asignación, Outbox, Inbox, retry y DLQ.
- Problema: dual-write y mensajes duplicados.
- Decisión: Outbox/Inbox transaccionales y publisher confirms.
- Evidencia: catálogo, ADR-003 y tests.
- Aprendizaje: asincronía no elimina fallos; los hace explícitos y recuperables.

## Cierre reproducible

- Objetivo: que otra persona pueda ejecutar y defender el módulo.
- Cambio: Compose con PostgreSQL/Redis/RabbitMQ, readiness, documentación y defensa.
- Problema: Docker daemon no disponible durante el cierre.
- Resultado: comprobaciones no Docker ejecutadas; las demás quedan marcadas como bloqueadas,
  sin declarar resultados falsos.
