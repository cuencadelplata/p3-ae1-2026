# Contrato de Integración: NotificationRequested (RF8.1 → RF8.7)

**Responsable RF8.7 (Entrega de Notificaciones):** Santiago Meza  
**Responsable RF8.1 (Notificaciones de Viaje):** Juan Invaldi  
**Estado:** CONTRATO INTERNO CONGELADO Y CONFIRMADO  
**Versión:** 1.0.0 (AE2)  
**Esquema JSON asociado:** [`schemas/notification-requested.v1.schema.json`](./schemas/notification-requested.v1.schema.json)

---

## 1. Propósito y Límites de Responsabilidad

Este contrato formaliza la frontera asíncrona entre el procesamiento lógico de notificaciones (**RF8.1**) y el subsistema de entrega de notificaciones (**RF8.7**) mediante mensajería AMQP (RabbitMQ) gestionada por **RF8.6**.

- **RF8.1 (Productor)**: Es dueño de interpretar los hechos de viaje de M6, persistir la notificación lógica de negocio, generar el texto correspondiente y almacenar la solicitud en su Transactional Outbox. No interactúa directamente con el transporte AMQP ni con proveedores PUSH reales o sandboxes.
- **RF8.7 (Consumidor)**: Recibe el evento `NotificationRequested`, aplica deduplicación e idempotencia estricta mediante `messageId`, gestiona el ciclo de vida del delivery (intentos, latencia, reintentos y persistencia en su propio esquema `delivery`) y despacha la entrega hacia el proveedor PUSH (sandbox o real). No interpreta el ciclo de vida de los viajes ni altera textos de negocio.

---

## 2. Parámetros de Transporte AMQP

| Parámetro | Valor Congelado |
| :--- | :--- |
| **Exchange** | `mobility.events` (Topic Exchange durable) |
| **Routing Key** | `notification.requested` |
| **Cola de RF8.7** | `m8.delivery.notification-requested` (Durable) |
| **Dead Letter Exchange (DLX)** | `mobility.events.dlx` |
| **Dead Letter Routing Key** | `dlq.notification.requested` |
| **Delivery Mode** | 2 (Mensaje persistente) |
| **Content-Type** | `application/json` |

---

## 3. Estructura del Mensaje (Envelope + Data)

```json
{
  "messageId": "7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a",
  "eventType": "NotificationRequested",
  "version": 1,
  "occurredAt": "2026-10-05T18:42:12.500Z",
  "correlationId": "trip-2026-000123",
  "producer": "m8-notifications",
  "data": {
    "notificationId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "tripId": "trip-2026-000123",
    "recipientId": 91,
    "eventType": "TRIP_STARTED",
    "channel": "PUSH",
    "title": "Viaje iniciado",
    "message": "Tu viaje ha comenzado.",
    "targetDestination": "fcm_token_device_abc123",
    "priority": "HIGH",
    "createdAt": "2026-10-05T18:42:12.000Z"
  }
}
```

---

## 4. Especificación Detallada de Campos

### 4.1 Campos del Sobre Común (Envelope)

| Campo | Tipo | Obligatorio | Formato / Restricción | Descripción |
| :--- | :--- | :---: | :--- | :--- |
| `messageId` | `string` | **Sí** | UUID v4 | Identificador universal único del mensaje. RF8.7 lo utiliza como clave única de idempotencia en su tabla Inbox. |
| `eventType` | `string` | **Sí** | Literal `"NotificationRequested"` | Identificador formal del tipo de evento en el catálogo común. |
| `version` | `integer`| **Sí** | `1` | Versión del contrato. Permite evolución no disruptiva. |
| `occurredAt` | `string` | **Sí** | ISO 8601 UTC | Timestamp en que RF8.1 preparó y emitió el evento. |
| `correlationId` | `string` | **Sí** | No vacío (ej. `trip-2026-000123`) | Identificador de trazabilidad transversal para seguimiento en logs estructurados. |
| `producer` | `string` | **Sí** | Literal `"m8-notifications"` | Servicio emisor originario. |
| `data` | `object` | **Sí** | Objeto JSON no nulo | Payload específico para la solicitud de entrega. |

### 4.2 Campos del Payload (`data`)

| Campo | Tipo | Obligatorio | Formato / Restricción | Descripción y Regla de Negocio |
| :--- | :--- | :---: | :--- | :--- |
| `notificationId` | `string` | **Sí** | UUID v4 | ID unívoco de la notificación lógica persistida en la DB de RF8.1. Permite vincular el registro de delivery al registro lógico. |
| `tripId` | `string` | **Sí** | No vacío | ID del viaje de M6 asociado a la notificación. |
| `recipientId` | `integer`| **Sí** | Entero $\ge 1$ | Identificador numérico canónico de M1 del destinatario (cliente o conductor). |
| `eventType` | `enum` | **Sí** | Uno de:<br>• `TRIP_REQUESTED`<br>• `DRIVER_ASSIGNED`<br>• `DRIVER_ARRIVED`<br>• `TRIP_STARTED`<br>• `TRIP_CANCELLED`<br>• `TRIP_COMPLETED` | Hecho de viaje que originó la notificación. Sirve a RF8.7 para categorización y fallback de título. |
| `channel` | `enum` | **Sí** | Literal `"PUSH"` | Canal de entrega solicitado. Para AE2 el canal normativo es exclusivamente `PUSH`. |
| `title` | `string` | No | Texto descriptivo corto | Título de la notificación PUSH. Si RF8.1 no lo envía, RF8.7 infiere un título adecuado a partir del `eventType`. |
| `message` | `string` | **Sí** | Texto no vacío | Contenido textual ya formateado por RF8.1 listo para entrega directa al usuario. |
| `targetDestination` | `string` | No | Token opaco | Token de registro de dispositivo (FCM / APNs) para delivery real. Si es omitido, RF8.7 utiliza el token asociado al `recipientId` en su registro sandbox. |
| `priority` | `enum` | No | `"HIGH"` \| `"NORMAL"` (Default: `"NORMAL"`) | Prioridad de despacho ante el proveedor de notificaciones. Eventos críticos (ej. `DRIVER_ARRIVED`, `TRIP_CANCELLED`) pueden despacharse con `HIGH`. |
| `createdAt` | `string` | **Sí** | ISO 8601 UTC | Fecha y hora en la que fue creada la notificación en el dominio de RF8.1. |

---

## 5. Información Necesaria para Efectuar Delivery Real en RF8.7

Para realizar un envío PUSH exitoso y auditable hacia un proveedor (sea sandbox o un gateway real como Firebase Cloud Messaging / Apple Push Notification service), RF8.7 requiere y resuelve:

1. **Destino Físico (`targetDestination`)**:
   - En un entorno de producción, representa el *Device Registration Token*.
   - Si RF8.1 no envía `targetDestination` (o mientras no haya integración directa de tokens con M1), RF8.7 provee una resolución determinista de token basada en `recipientId` (ej. `sandbox_token_${recipientId}`), garantizando que el sandbox opere de forma reproducible y sin acoplamiento no acordado.
2. **Cuerpo y Título de Notificación**:
   - El mensaje ya formateado (`message`) provisto por RF8.1 es el cuerpo textual definitivo. RF8.7 no altera ni recalcula textos de negocio.
   - Si no se especifica `title`, RF8.7 aplica un mapeo canónico:
     - `TRIP_REQUESTED` → "Solicitud de viaje"
     - `DRIVER_ASSIGNED` → "Conductor asignado"
     - `DRIVER_ARRIVED` → "Tu conductor ha llegado"
     - `TRIP_STARTED` → "Viaje en curso"
     - `TRIP_CANCELLED` → "Viaje cancelado"
     - `TRIP_COMPLETED` → "Viaje finalizado"
3. **Metadatos de Seguimiento**:
   - `tripId` y `notificationId` se adjuntan en el payload de datos del PUSH para que la aplicación cliente móvil pueda correlacionar la notificación con el viaje activo.

---

## 6. Compatibilidad y Trazabilidad

- Este contrato mantiene **100% de compatibilidad binaria y contractual** con la interfaz `NotificationRequestedData` ya presente en el código de RF8.1 (`modulo-8/services/notifications/src/notifications/notification.types.ts`).
- Los campos agregados para soportar delivery real (`title`, `targetDestination`, `priority`) son estrictamente opcionales, garantizando que el Outbox actual de RF8.1 funcione sin requerir modificaciones forzadas.
