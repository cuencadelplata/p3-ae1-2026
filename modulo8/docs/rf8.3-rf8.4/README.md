# Comprobantes y reenvío (RF8.3 y RF8.4)

RF8.3 consulta el pago autorizado en M7, emite el comprobante PDF una sola vez
y conserva sus datos en PostgreSQL. RF8.4 solicita un nuevo enlace o envío del
mismo comprobante, sin regenerarlo. Ambos se montan en la aplicación única M8.

| Tema | Documento |
| --- | --- |
| Rutas HTTP de la app | [OpenAPI integrado](../../openapi/m8-openapi.yaml) |
| Detalle de comprobantes | [OpenAPI de comprobantes](../../openapi/receipts.openapi.yaml) |
| Eventos y contrato de pago M7 | [Catálogo](../../contracts/events/catalogo-eventos-v1.md) |
| RabbitMQ y Redis | [ADR-003](adr/ADR-003-backing-services-ae2.md) |
| Persistencia y PDF | [ADR-004](adr/ADR-004-persistencia-ae2.md) |
| Fallas de dependencias | [ADR-005](adr/ADR-005-resiliencia-ae2.md) |
| Concurrencia e idempotencia | [Pruebas](pruebas/concurrencia-idempotencia-ae2.md) |
| Puesta en marcha del módulo | [README principal](../../README.md) |
