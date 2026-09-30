# Estado de requisitos M8

| RF | Responsabilidad | Estado AE1 | Servicio / protocolo | Evidencia y deuda AE2 |
| --- | --- | --- | --- | --- |
| RF8.1 | Notificaciones de viaje | Implementado | Notifications / HTTP | Tests del servicio y E2E. Push mock; delivery, persistencia e idempotencia pendientes. |
| RF8.2 | QR temporal | Implementado | QR / HTTP | Tests del servicio y E2E. Estado en memoria; almacenamiento distribuido pendiente. |
| RF8.3 | Comprobante PDF | Implementado (AE2 2.0.0) | Receipts / HTTP y RabbitMQ | Emisión por `POST` y por `payment.confirmed`; PostgreSQL; `receipt.issued`; enlace temporal en Redis. |
| RF8.4 | Reenvío de comprobante | Implementado dentro de Receipts | Receipts / HTTP | Reenvío simulado; delivery independiente pendiente. |
| RF8.5 | Tickets de soporte | Implementado | Support / HTTP | Tickets en memoria y tests de controller/modelo. |
| RF8.6 | Integración asíncrona | Base/código AE1 existente | Support / RabbitMQ | Exchange, cola, bindings, publish/consume validados. Faltan eventId, inbox, dedupe, retry, NACK/DLQ. |
| RF8.7 | Entrega de notificaciones | Pendiente AE2 | — | `PushProvider` mock de RF8.1 no constituye servicio final de delivery. |

Hay siete RF definidos: seis tienen implementación o código AE1 actual y RF8.7 queda pendiente para AE2.
