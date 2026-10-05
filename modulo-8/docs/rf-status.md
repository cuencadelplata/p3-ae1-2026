# Estado de requisitos M8

| RF | Responsabilidad | Estado AE1 | Servicio / protocolo | Evidencia y deuda AE2 |
| --- | --- | --- | --- | --- |
| RF8.1 | Notificaciones de viaje | Implementado | Notifications / HTTP | Tests del servicio y E2E. Push mock; delivery, persistencia e idempotencia pendientes. |
| RF8.2 | QR temporal | Implementado (AE2 2.0.0) | QR / HTTP | Redis con TTL y consumo atómico (Lua) válido entre instancias; 503 fail-closed ante Redis caído o lento; health por dependencia; logs con correlationId. Evidencia en `services/qr/docs/ae2-rf82.md`. Pendiente: contrato con M6 y QR múltiples por viaje. |
| RF8.3 | Comprobante PDF | Implementado (AE2 2.1.0) | Receipts / HTTP y RabbitMQ | Emisión por `POST` y por `payment.confirmed`; PostgreSQL; `receipt.issued`; enlace temporal en Redis; autorización ante un servicio externo simulado con timeout y circuit breaker. |
| RF8.4 | Reenvío de comprobante | Implementado dentro de Receipts | Receipts / HTTP | Reenvío simulado; delivery independiente pendiente. |
| RF8.5 | Tickets de soporte | Implementado (AE2) | Support / HTTP | Tickets e historial de estados en PostgreSQL (esquema `support`, migraciones al arranque); transiciones validadas, versión optimista, `Idempotency-Key`, filtros y paginación; errores con código y `X-Correlation-Id`; `/health/ready`. Contrato en `openapi/rf85-support.yaml`. Evidencia: 304 tests unitarios, 71 de integración contra PostgreSQL (concurrencia y rollback) y las pruebas `prueba:resiliencia` y `prueba:resiliencia:db` contra el stack. Pendiente: el consumer RabbitMQ de AE1 sigue dentro de Support hasta su extracción a RF8.6 (`services/support/docs/rf86-handoff.md`) y falta el registro en la aplicación única de M8. |
| RF8.6 | Integración asíncrona | Base/código AE1 existente | Support / RabbitMQ | Exchange, cola, bindings, publish/consume validados. Faltan eventId, inbox, dedupe, retry, NACK/DLQ. |
| RF8.7 | Entrega de notificaciones | Pendiente AE2 | — | `PushProvider` mock de RF8.1 no constituye servicio final de delivery. |

Hay siete RF definidos: seis tienen implementación o código AE1 actual y RF8.7 queda pendiente para AE2.
