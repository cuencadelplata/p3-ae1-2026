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
| **RF8.1 Notificaciones** | Crea la notificación lógica. | Eventos de viaje **propuestos**, [catálogo §5.4](events/catalogo-eventos-v1.md#54-contrato-de-entrada-rf86--rf81-eventos-de-viaje); salida interna [`NotificationRequested`](events/rf87-notification-requested.contract.md). |
| **RF8.2 QR** | Genera y valida QR de un uso. | [OpenAPI QR](../openapi/qr.openapi.yaml); [acuerdo técnico con M6](../docs/rf8.2/contrato-m6.md). No usa RabbitMQ para validar. |
| **RF8.3 Comprobante** | Emite y guarda el PDF. | [OpenAPI de comprobantes](../openapi/receipts.openapi.yaml); pago de M7 por REST y eventos de emisión en el [catálogo](events/catalogo-eventos-v1.md). `payment.confirmed` conserva sólo un productor simulado. |
| **RF8.4 Reenvío** | Reutiliza el comprobante y genera una referencia de entrega. | Rutas con etiqueta `ReceiptResend` en el [OpenAPI integrado](../openapi/m8-openapi.yaml) y detalle de reenvío en el [contrato de comprobantes](../openapi/receipts.openapi.yaml). |
| **RF8.5 Soporte** | Gestiona tickets e historial. | [OpenAPI de soporte](../openapi/rf85-support.yaml). |
| **RF8.6 Mensajería** | Conecta RabbitMQ, valida, deduplica, reintenta y deriva a DLQ. | [Catálogo](events/catalogo-eventos-v1.md) y contrato externo [M3 → documento registrado](events/m3-driver-document-registered.contract.md). |
| **RF8.7 Entrega** | Intenta el PUSH y conserva intentos y resultados. | [OpenAPI de dispositivos y entregas](../openapi/notification-delivery.openapi.yaml), [`NotificationRequested`](events/rf87-notification-requested.contract.md) y [esquema JSON](events/schemas/notification-requested.v1.schema.json). |

## Estado de los acuerdos externos

- **M3:** el contrato `documento.registrado` está publicado; falta la prueba
  conjunta que acredite la relación entre `driverId` y el usuario de M1.
- **M5/M6:** los eventos de viaje del catálogo son una propuesta. Falta acordar
  destinatario numérico, rol, hechos y topología antes de montar el consumidor.
- **M7:** M8 consulta `GET /metodo-pago/{viajeId}` con `x-api-key`; la prueba entre
  servicios reales se hará en la integración común.

Los contratos anteriores permanecen trazables en el historial Git.
