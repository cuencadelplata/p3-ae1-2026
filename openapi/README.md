# Contratos HTTP de M8

[`m8-openapi.yaml`](m8-openapi.yaml) describe las rutas de la **aplicación única**
que se exponen en `/openapi.yaml` y `/docs`. Es el punto de entrada para otros
módulos y para el frontend común.

| Archivo | Alcance |
| --- | --- |
| [`qr.openapi.yaml`](qr.openapi.yaml) | RF8.2: generación, validación, expiración y errores del QR. |
| [`receipts.openapi.yaml`](receipts.openapi.yaml) | RF8.3 y RF8.4: emisión, consulta, PDF y reenvío. |
| [`rf85-support.yaml`](rf85-support.yaml) | RF8.5: detalle de tickets, estados e historial. |
| [`notification-delivery.openapi.yaml`](notification-delivery.openapi.yaml) | RF8.7: registro de dispositivos y consulta de entregas. |

RF8.4 está incluido en `receipts.openapi.yaml` y aparece bajo la etiqueta
`ReceiptResend` en el contrato integrado. RF8.7 tiene su contrato detallado
propio y también aparece bajo `NotificationDelivery` en el contrato integrado.

RF8.6 no expone una API REST de entrada para eventos: sus contratos están en
[`contracts/events/`](../contracts/events/). La ruta antigua `POST /notifications`
no representa el flujo asíncrono actual de RF8.1.

La prueba de consistencia compara rutas y códigos de respuesta de los cuatro
contratos detallados activos con el OpenAPI integrado.
