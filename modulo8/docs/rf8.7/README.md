# RF8.7 — Entrega de notificaciones

RF8.7 recibe `NotificationRequested` de RF8.1, consulta las preferencias de
clientes a M2, identifica los tokens activos en M8 y registra cada intento y
resultado de entrega. No crea la notificación lógica ni su texto.

- [Contrato de `NotificationRequested`](../../contracts/events/rf87-notification-requested.contract.md).
- [OpenAPI propio de dispositivos y entregas](../../openapi/notification-delivery.openapi.yaml).
- [ADR de idempotencia y resiliencia](adr/ADR-001-rf87-idempotencia-y-resiliencia.md).
- [ADR de persistencia y preferencias](adr/ADR-002-rf87-persistencia-y-ciclo-vida-delivery.md).

La consulta a M2 real y el envío PUSH real requieren prueba conjunta durante la
integración entre módulos.
