# Contratos de M8 por requerimiento

**HTTP:** [OpenAPI integrado](../openapi/m8-openapi.yaml) es el contrato de las
rutas que sirve la aplicación única. Los YAML por RF amplían ejemplos y reglas;
el [índice HTTP](../openapi/README.md) indica cuáles corresponden a cada RF.

**RabbitMQ:** el [catálogo de eventos](events/catalogo-eventos-v1.md) reúne
exchange, routing keys, envelope, productores y consumidores. Cada contrato
específico se enlaza abajo. Una propuesta pendiente no acredita integración
con un productor real.

| RF | Qué hace | Contratos que le corresponden |
| --- | --- | --- |
| **RF8.1 Notificaciones** | Crea la notificación lógica. | [M5 → solicitudes, asignaciones y cancelaciones](events/m5-m8-notificaciones.md); `DriverArrived` y `TripStarted` acordados con M6; salida interna [`NotificationRequested`](events/rf87-notification-requested.contract.md). |
| **RF8.2 QR** | Genera y valida QR de un uso. | [OpenAPI QR](../openapi/qr.openapi.yaml); [acuerdo técnico con M6](../docs/rf8.2/contrato-m6.md). No usa RabbitMQ para validar. |
| **RF8.3 Comprobante** | Emite y guarda el PDF. | [OpenAPI de comprobantes](../openapi/receipts.openapi.yaml); pago de M7 por REST y eventos de emisión en el [catálogo](events/catalogo-eventos-v1.md). `payment.confirmed` conserva sólo un productor simulado. |
| **RF8.4 Reenvío** | Reutiliza el comprobante y genera una referencia de entrega. | Rutas con etiqueta `ReceiptResend` en el [OpenAPI integrado](../openapi/m8-openapi.yaml) y detalle de reenvío en el [contrato de comprobantes](../openapi/receipts.openapi.yaml). |
| **RF8.5 Soporte** | Gestiona tickets e historial. | [OpenAPI de soporte](../openapi/rf85-support.yaml). |
| **RF8.6 Mensajería** | Conecta RabbitMQ, valida, deduplica, reintenta y deriva a DLQ. | [Catálogo](events/catalogo-eventos-v1.md), [M5 → M8](events/m5-m8-notificaciones.md) y [M3 → documento registrado](events/m3-driver-document-registered.contract.md). |
| **RF8.7 Entrega** | Intenta el PUSH y conserva intentos y resultados. | [OpenAPI de dispositivos y entregas](../openapi/notification-delivery.openapi.yaml), [`NotificationRequested`](events/rf87-notification-requested.contract.md) y [esquema JSON](events/schemas/notification-requested.v1.schema.json). |

## Estado de los acuerdos externos

- **M3:** el contrato `documento.registrado` está publicado; falta la prueba
  conjunta que acredite la relación entre `driverId` y el usuario de M1.
- **M5:** `ride.requested`, `driver.offer.accepted` y
  `ride_request.cancelled` usan usuarios numéricos de M1. M8 monta una cola
  propia para los tres eventos y guarda avisos con Outbox. M5 documentó que
  no recupera automáticamente un evento no publicado si RabbitMQ está caído.
- **M6:** `DriverArrived` y `TripStarted` usan `recipientId` numérico de M1
  en `mobility.events`. M8 monta el consumidor; falta la prueba conjunta con
  M6 real.
- **M7:** M8 consulta `GET /metodo-pago/{viajeId}` con `x-api-key`; la prueba entre
  servicios reales se hará en la integración común.

Los contratos anteriores permanecen trazables en el historial Git.
