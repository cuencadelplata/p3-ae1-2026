# Catálogo de eventos M8 — versión 1 (AE2)

Contrato asíncrono acordado para la AE2. Define la topología de RabbitMQ, el
sobre común de los mensajes y los eventos que produce o consume el servicio de
comprobantes (RF-8.3). Incluye además el contrato REST interno acordado con
Receipts Delivery (RF-8.4), porque forma parte de la misma integración. También
registra objetivos internos comunes de M8 que RF8.6 centralizará durante la
integración, sin afirmar que ya estén implementados fuera de RF8.3.

Reemplaza al contrato AE1 de RabbitMQ, disponible en el historial Git.

## 1. Registro de acuerdos

| Fecha | Tema | Acordado con | Estado |
| --- | --- | --- | --- |
| 2026-09-29 | Exchange único, convención de nombres y sobre común | Grupo M8 | Acordado |
| 2026-09-29 | Comprobantes consume `payment.confirmed` desde su propia cola | Damián Caminos (RF-8.6) | Acordado |
| 2026-09-29 | Referencia de descarga temporal para reenvíos | Lucas Cremaschi (RF-8.4) | Acordado |
| 2026-09-30 | Contenido de `payment.confirmed` | Grupo M7 | Respondido sin cubrir los datos del comprobante; se mantiene la alternativa 1 de forma provisoria (ver 5.1) |
| 2026-10-04 | Propuesta de entrada RF8.6 → RF8.1 (eventos de viaje, sobre, deduplicación, queue/bindings) y Outbox RF8.1 → RF8.7 | Damián Caminos (RF-8.6) / Invaldi (M8) | Outbox interno confirmado; entrada externa pendiente con M5/M6 |
| 2026-10-04 | Forma de integración de M7 con Comprobantes | M7 (RF-7.3) / Invaldi (M8) | M7 se integra solo por REST y no publicará `payment.confirmed`. Comprobantes consulta `GET /metodo-pago/{viajeId}` de M7 y emite solo con el pago autorizado (ver 5.1). Importe y moneda: consulta pendiente a M7 |
| 2026-10-05 | Importe cobrado en la respuesta de M7 | M7 (RF-7.3) | M7 agregó `total` y `moneda` a `GET /metodo-pago/{viajeId}`, guardados al autorizar (commit `063e112` de M7). Comprobantes los usa desde la versión 2.3.0 (ver 5.1) |
| 2026-10-04 | El reenvío devuelve el enlace temporal de la sección 6 | Lucas Cremaschi (RF-8.4) | Acordado sin cambios en el contrato |
| 2026-11-23 | Disparador de Comprobantes en el Compose común (AE4) | M6 (contrato ya publicado) | Comprobantes consume `TripCompleted` de M6 en su propia cola y completa los datos por REST con M6, M3 y M7 (ver 5.6). No requiere cambios en M6 |
| 2026-11-23 | Efectivo y transferencia pendientes en M7 | Grupo M8 (M7 se adapta) | Se emite el comprobante con el pago pendiente (ver 5.1). Mientras M7 no corra en el Compose común se usa el simulador de su contrato (perfil `m7-sandbox`) |


## 2. Topología

| Elemento | Valor |
| --- | --- |
| Exchange principal | `mobility.events` (tipo `topic`, durable) |
| Exchange de descarte | `mobility.events.dlx` (tipo `topic`, durable) |
| Routing keys | `<entidad>.<hecho-en-pasado>`, en minúsculas. Ej.: `payment.confirmed` |
| Colas | `<modulo>.<proposito>`, una por consumidor y propósito |
| Colas de descarte | `<cola>.dlq`, ligadas a `mobility.events.dlx` |

Cada cola de consumo declara `x-dead-letter-exchange: mobility.events.dlx` y
`x-dead-letter-routing-key: <cola>`. Usar el nombre de la cola como clave de
descarte hace que cada DLQ reciba solo los rechazos de su propio consumidor,
aunque varios módulos consuman el mismo evento. Una cola por consumidor evita
que dos módulos compitan por el mismo mensaje: cada uno recibe su propia copia.

### Colas del servicio de comprobantes

| Cola | Función |
| --- | --- |
| `m8.receipts.payment-confirmed` | Ligada a `mobility.events` con `payment.confirmed`. La consume el servicio. |
| `m8.receipts.payment-confirmed.retry` | Sin consumidores. El mensaje espera ahí el tiempo de reintento y RabbitMQ lo devuelve a la cola principal. |
| `m8.receipts.payment-confirmed.dlq` | Ligada a `mobility.events.dlx` con la clave `m8.receipts.payment-confirmed`. Mensajes inválidos o con reintentos agotados. |
| `m8.receipts.trip-completed` | Ligada a `mobility.events` con `trip.completed` (M6). Se declara solo si `M6_TRIPS_URL` está configurada (Compose común). |
| `m8.receipts.trip-completed.retry` | Igual que la de `payment-confirmed`: espera sin consumidores y vuelve a la cola principal. |
| `m8.receipts.trip-completed.dlq` | Ligada a `mobility.events.dlx` con la clave `m8.receipts.trip-completed`. |

## 3. Sobre del mensaje

Todo mensaje publicado en `mobility.events` respeta esta estructura,
independientemente del módulo que lo emita. Los metadatos son iguales para
todos los eventos; `data` es propio de cada tipo.

```json
{
  "messageId": "9f1c7b2e-4d3a-4c8f-9b21-6e0a5c7d4812",
  "eventType": "PaymentConfirmed",
  "version": 1,
  "occurredAt": "2026-10-05T18:42:11.000Z",
  "correlationId": "trip-2026-000123",
  "producer": "m7-pagos",
  "data": {}
}
```

| Campo | Tipo | Regla |
| --- | --- | --- |
| `messageId` | string (UUID v4) | Único por mensaje. Un reintento del mismo mensaje conserva el mismo valor. Es la clave de deduplicación. |
| `eventType` | string | Nombre del evento en PascalCase (`PaymentConfirmed`). |
| `version` | entero ≥ 1 | Versión del esquema de `data`. |
| `occurredAt` | string (ISO 8601, UTC) | Momento en que ocurrió el hecho, no el de publicación. |
| `correlationId` | string | Identificador del viaje (`tripId`). Se propaga a los logs para reconstruir el flujo. |
| `producer` | string | Servicio emisor (`m7-pagos`, `m8-receipts`, ...). |
| `data` | objeto | Carga útil propia del evento. |

Propiedades AMQP de publicación: `content_type: application/json`,
`delivery_mode: 2` (persistente) y `message_id` igual a `messageId`.

`eventType` identifica el contrato semántico del evento. La routing key AMQP
define su enrutamiento. No son valores equivalentes ni intercambiables: por
ejemplo, `PaymentConfirmed` se enruta como `payment.confirmed` y
`ReceiptIssued` como `receipt.issued`.

### Política de versionado

- Agregar campos opcionales a `data` no cambia la versión.
- Quitar, renombrar o cambiar el tipo de un campo requiere incrementar
  `version` y avisar antes a los consumidores.
- Los consumidores ignoran los campos que no conocen.

## 4. Reglas para consumidores

1. **Validación del sobre.** Un mensaje que no respeta el sobre o el esquema de
   su evento se rechaza sin reintento y va directo a la cola de descarte.
2. **Idempotencia e Inbox.** Estado actual: RF8.3 posee un Inbox propio que
   deduplica sus mensajes. Objetivo común AE2: el Inbox técnico tendrá
   `UNIQUE(consumerId, messageId)`, para que el mismo `messageId` pueda ser
   procesado legítimamente por consumidores distintos. Si ya existe para ese
   consumidor, el mensaje se confirma sin volver a procesarse. Cada RF mantiene
   además su idempotencia de negocio.
3. **Marcado y ACK manual.** El Inbox se marca como procesado sólo después de
   que el handler finaliza correctamente y el efecto queda persistido; recién
   entonces se realiza el ACK.
4. **Reintentos.** Política común objetivo AE2: ante un fallo reintentable el
   mensaje se republica en `<cola>.retry` con `x-retry-count` incrementado y una
   espera fija (`CONSUMER_RETRY_DELAY_MS`, 5 s por defecto). El máximo es tres
   intentos (`CONSUMER_MAX_RETRIES`) y luego el mensaje va a la DLQ.
   Estado actual: RF8.3 conserva un camino particular para
   `dependency-unavailable` que no incrementa el contador. Esa ruta debe
   alinearse a la política común durante la extracción de infraestructura hacia
   RF8.6; no se afirma que ya cumpla el máximo común en todos sus caminos.
5. **Cola de descarte.** Los mensajes quedan disponibles para inspección y
   reprocesamiento manual sin bloquear la cola principal.

RabbitMQ garantiza entrega al menos una vez: la regla 2 es la que evita efectos
duplicados ante reconexiones o reintentos.

### Ownership técnico común (objetivo AE2)

RF8.6 será el owner técnico del transporte RabbitMQ compartido: envelope,
exchanges, queues y bindings, Inbox, ACK/NACK, retry, DLQ, routing y adaptadores
externos. Cada RF mantiene sus validaciones, persistencia, lógica e
idempotencia de negocio. RF8.3 conserva mientras tanto su implementación actual
como estado heredado que se integrará sin degradar sus decisiones funcionales.

## 5. Eventos

### 5.1 `payment.confirmed`

| Atributo | Valor |
| --- | --- |
| `eventType` | `PaymentConfirmed` |
| Versión | 1 |
| Productor | M7 — Tarifas, Pagos y Liquidaciones |
| Consumidores | M8 — Comprobantes (`m8.receipts.payment-confirmed`) |
| Estado | **Provisorio, sin productor real**: M7 informó el 2026-10-04 que se integra por API (ver "Actualización de M7") |

Efecto en M8: emite el comprobante del viaje y genera su PDF (RF-8.3).

Contenido propuesto de `data`:

```json
{
  "tripId": "trip-2026-000123",
  "paymentId": "pay-000981",
  "confirmedAt": "2026-10-05T18:42:10.000Z",
  "method": "TARJETA",
  "status": "APROBADO",
  "authorizationCode": "AUT-55821",
  "fare": {
    "currency": "ARS",
    "baseFare": 1200,
    "distanceAmount": 3450.5,
    "timeAmount": 890,
    "surcharges": 0,
    "discounts": 150,
    "total": 5390.5
  },
  "customer": { "id": "cli-0091", "fullName": "Lucia Fernandez", "email": "lucia.fernandez@example.com" },
  "driver": {
    "id": "cnd-0457",
    "fullName": "Martin Rodriguez",
    "vehicle": { "type": "AUTO", "plate": "AB123CD", "model": "Toyota Etios 2021" }
  },
  "trip": {
    "origin": "Av. Colon 1250",
    "destination": "Aeropuerto",
    "startedAt": "2026-10-05T18:05:00.000Z",
    "finishedAt": "2026-10-05T18:36:00.000Z",
    "distanceKm": 14.8,
    "durationMin": 31
  }
}
```

`customer`, `driver` y `trip` siguen el mismo esquema que el contrato REST de
emisión (`POST /api/v1/receipts`). Se incluyen de forma provisoria según la
alternativa 1 del punto abierto (abajo).

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `tripId` | string | Sí | Letras, números, guion y guion bajo; hasta 64 caracteres. |
| `paymentId` | string | Sí | Identificador del pago en M7. |
| `confirmedAt` | string (ISO 8601) | Sí | |
| `method` | enum | Sí | `EFECTIVO`, `TARJETA`, `BILLETERA`. |
| `status` | enum | Sí | `APROBADO`. |
| `authorizationCode` | string | No | |
| `fare.currency` | string (ISO 4217) | Sí | |
| `fare.total` | número | Sí | Mayor o igual a 0. |
| `fare.baseFare`, `distanceAmount`, `timeAmount`, `surcharges`, `discounts` | número | No | Si se informan, deben cerrar con `total` (tolerancia de un centavo). |
| `customer` | objeto | Sí (provisorio) | `id`, `fullName`; `email` y `documentId` opcionales. |
| `driver` | objeto | Sí (provisorio) | `id`, `fullName`, `vehicle.type` (`AUTO`/`MOTO`), `vehicle.plate`. |
| `trip` | objeto | Sí (provisorio) | `origin`, `destination`, `startedAt`, `finishedAt`, `distanceKm`, `durationMin`. |

Además, `correlationId` del sobre debe coincidir con `data.tripId`. Un mensaje
que no cumple estas reglas es inválido y va a la cola de descarte sin
reintentos.

**Punto abierto.** El comprobante también muestra datos del cliente, del
conductor y del recorrido, que no son propiedad de M7. Se contemplan dos
alternativas:

- M7 incluye esos datos en `data`, tomados del viaje que ya conoce.
- M8 consume además `trip.completed` (M6) y emite el comprobante cuando tiene
  ambos eventos del mismo `tripId`.

**Respuesta de M7 (2026-09-30).** M7 compartió su modelo de pago (`MetodoPago`):
`pagoId`, `clienteId`, `viajeId`, `tipo`, `detalle`, `fecha` y `estado`. Sus datos
de viaje dependen de M6. Frente a este catálogo:

| Tema | Este catálogo | Modelo de M7 |
| --- | --- | --- |
| Importes (`fare`) | Obligatorios | No los incluye |
| Cliente, conductor y recorrido | Obligatorios (provisorio) | Solo `clienteId` |
| Medio de pago | `EFECTIVO`, `TARJETA`, `BILLETERA` | efectivo, tarjeta, transferencia |
| Estado del pago | `APROBADO` | pendiente, autorizado, rechazado |
| Sobre del mensaje (`messageId`, `correlationId`) | Obligatorio | No lo menciona |

La respuesta describe el modelo interno de M7, no el evento publicado, y no
alcanza para emitir el comprobante. Para AE2 se mantiene la alternativa 1 de
forma provisoria: el servicio funciona y se prueba con este contrato. El cierre
queda para la integración de AE4, por alguno de estos caminos: que M7 agregue
importes y sobre al evento, o la alternativa 2 (consumir además `trip.completed`
de M6). En ambos casos solo cambia la traducción del evento
(`src/messaging/payment-confirmed.ts`), no la emisión.

**Actualización de M7 (2026-10-04).** M7 (RF-7.3) informó que no publicará este
evento: se integra solo por REST, porque en AE4 debe usar la API de Mercado Pago
(en AE2 la simula) y no quiere cambiar la forma de integración dos veces. M7 no
llama a M8: expone el estado del pago para que lo consulte quien lo necesite.

Contrato REST de M7 que consume Comprobantes (openapi.yaml de M7, RF-7.2 y RF-7.3):

```
GET /metodo-pago/{viajeId}
200 { pagoId, clienteId, viajeId, tipo, detalle, fecha, estado, total?, moneda? }
404 { mensaje }   (el viaje no tiene un pago registrado)
```

**Revisión de la rama publicada de M7 (2026-11-15):** el GET exige `x-api-key`
con la clave `M7_API_KEY` de M7. M8 la configura con el mismo nombre fuera de
Git; el sandbox local no exige esa clave. El código de M7 conserva `total` y
`moneda` al autorizar, pero su OpenAPI publicado aún no documenta esos campos
ni la autenticación del GET. M7 ya tiene un cliente para la API de Mercado Pago;
la respuesta real de un pago autorizado y la prueba conjunta quedan para la
rama común.

| M7 | Modelo de Comprobantes | Efecto en la emisión |
| --- | --- | --- |
| `estado: autorizado` | `APROBADO` | Se emite. |
| `estado: pendiente` con `tipo: efectivo` o `transferencia` (desde 2026-11-23) | `PENDIENTE` | Se emite con el pago pendiente: esos medios se cobran fuera de la pasarela y M7 no los autoriza después. Acuerdo del grupo M8. |
| `estado: pendiente` con tarjeta, o `404` | `PENDIENTE` / sin pago | No se emite. Reintentable: `409 PAYMENT_PENDING` o `PAYMENT_NOT_FOUND` por REST; reintento con descuento de intentos en el consumidor. |
| `estado: rechazado` | `RECHAZADO` | No se emite. Terminal: `422 PAYMENT_REJECTED` por REST; DLQ sin reintentos en el consumidor. |
| Sin respuesta, `5xx` o fuera de contrato | — | Dependencia no disponible: `503 PAYMENTS_SERVICE_UNAVAILABLE`; el mensaje espera sin descontar intentos. |
| `tipo: efectivo` / `tarjeta` / `transferencia` | `EFECTIVO` / `TARJETA` / `TRANSFERENCIA` | El medio de pago del comprobante se toma de M7. |
| `total`, `moneda` (por defecto `ARS`), desde 2026-10-05 | `fare.total`, `fare.currency` | El importe del comprobante se toma de M7. El desglose de la entrada se conserva solo si está en la misma moneda y suma ese total (tolerancia de un centavo); si no, el comprobante muestra solo el total. Sin `total`, se usa la tarifa de la entrada. |

En consecuencia:

- Comprobantes consulta a M7 antes de emitir, tanto en `POST /api/v1/receipts`
  como al consumir este evento. El cliente REST no depende de un evento
  disparador. En el Compose común (AE4) el disparador es `trip.completed` de M6,
  consumido directamente por Comprobantes en su propia cola (sección 5.6).
- M7 agregó `total` y `moneda` a su respuesta el 2026-10-05, a pedido de
  Comprobantes; se informan recién al autorizar el pago. El desglose de la tarifa
  no es de M7: sigue llegando en la entrada y solo se muestra si cierra con el
  total cobrado.
- Cliente, conductor y recorrido se mantienen como están hasta cerrar los
  contratos con M1, M2, M3 y M6.
- Este evento se conserva como entrada asíncrona, con productor simulado en AE2
  (`scripts/publicar-pago-confirmado.mjs`).
- Para pruebas reproducibles, M7 se simula en `infra/m7-payments-sandbox` con su
  mismo contrato.

### 5.2 `receipt.issued`

| Atributo | Valor |
| --- | --- |
| `eventType` | `ReceiptIssued` |
| Versión | 1 |
| Productor | M8 — Comprobantes (`m8-receipts`) |
| Consumidores | Suscripción libre (ej.: M2 para historial, Notificaciones para avisar al cliente) |
| Estado | Definido por M8 |

Se publica una única vez por comprobante, después de persistirlo, sea que la
emisión llegue por `payment.confirmed` o por `POST /api/v1/receipts`. Un
evento `payment.confirmed` repetido no genera un segundo `receipt.issued`.

**Publicación mediante bandeja de salida.** El evento se guarda en la tabla
`receipts.outbox_events` en la misma transacción que el comprobante, y un
proceso del servicio lo publica en `mobility.events` con la routing key
`receipt.issued`. Se marca como publicado recién cuando RabbitMQ confirma la
recepción. En consecuencia:

- Si el comprobante no se persiste, el evento no existe.
- Si RabbitMQ no está disponible, el evento espera en la tabla y se publica al
  recuperar la conexión (`OUTBOX_POLL_INTERVAL_MS`, 1 s por defecto).
- Ante un corte entre la confirmación de RabbitMQ y la marca en la base, el
  evento se republica con el **mismo** `messageId`. Los consumidores deben
  deduplicar por `messageId` (regla 2 de la sección 4).
- Con varias instancias del servicio, cada evento lo publica una sola de ellas
  (`FOR UPDATE SKIP LOCKED`).

```json
{
  "tripId": "trip-2026-000123",
  "receiptId": "0b7d4c1e-2f6a-4e51-9d0c-8a3b1f7e6c25",
  "receiptNumber": "CMP-2026-3176686383",
  "issuedAt": "2026-10-05T18:42:12.000Z"
}
```

`data` no incluye datos personales ni enlaces de descarga: quien necesite el
documento lo solicita por contrato (sección 6).

### 5.3 `notification.requested` (Outbox RF8.1 → RF8.7)

| Atributo | Valor |
| --- | --- |
| `eventType` | `NotificationRequested` |
| Routing key | `notification.requested` |
| Productor | RF8.1 — Notificaciones (`m8-notifications`) |
| Consumidor | RF8.7 — Entrega de notificaciones (`m8.delivery.notification-requested`) |
| Estado | **CONTRATO INTERNO CONGELADO Y CONFIRMADO** |

Su finalidad es solicitar la entrega de una notificación lógica ya creada por RF8.1. Se emite vía el patrón Transactional Outbox (`notifications.outbox_deliveries`) y es publicado por RF8.6 en RabbitMQ (`mobility.events`).

**Estructura del mensaje:**

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
    "message": "Tu viaje ha comenzado.",
    "createdAt": "2026-10-05T18:42:12.000Z"
  }
}
```

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `notificationId` | string (UUID v4) | Sí | ID de la notificación lógica creada en RF8.1. |
| `tripId` | string | Según evento | ID del viaje; no corresponde a `TRIP_REQUESTED` ni `DRIVER_DOCUMENT_REGISTERED`. |
| `recipientId` | number, entero seguro ≥ 1 | Sí | `userId` numérico canónico de M1. No es el `clienteId` libre de M6. |
| `eventType` | enum | Sí | Evento de viaje en notificaciones (`TRIP_REQUESTED`, `DRIVER_ASSIGNED`, etc.). |
| `channel` | enum | Sí | Canal de entrega (`PUSH`). |
| `message` | string | Sí | Mensaje formateado listo para ser enviado por el proveedor de entrega. |
| `createdAt` | string (ISO 8601) | Sí | Timestamp de creación de la notificación lógica. |

**Publicación y marcado de `published_at`:**
1. El registro se guarda en la tabla `outbox_deliveries` en la misma transacción DB que crea la notificación.
2. El worker de Outbox Relay (RF8.6) consulta registros con `published_at IS NULL ORDER BY created_at ASC` aplicando bloqueo `FOR UPDATE SKIP LOCKED`.
3. RF8.6 publica el mensaje en `mobility.events` con routing key `notification.requested`.
4. Únicamente **después** de recibir la confirmación (Publisher Confirm ACK) de RabbitMQ, el worker marca `published_at = NOW()` en la base de datos.
5. Si RabbitMQ o la DB caen, el mensaje se reintenta conservando el mismo `messageId`, delegando la deduplicación al Inbox de RF8.7 (`UNIQUE(consumer_id, message_id)`).

---

### 5.4 Contrato de Entrada RF8.6 → RF8.1 (Eventos de Viaje)

| Atributo | Valor |
| --- | --- |
| Routing keys activas | M5: `ride.requested`, `driver.offer.accepted`, `ride_request.cancelled`; M6: `driver.arrived`, `trip.started`, `trip.completed`, `trip.cancelled` |
| Productor | M6 (Viajes) / M5 (Despacho) |
| Consumidor | RF8.6: colas `m8.notifications.m5-events` y `m8.notifications.trip-events` |
| Estado | Contratos M5 y M6 acordados; consumidores locales activos. La prueba conjunta con los productores reales se realiza en la rama común. |

**Acuerdo informado por M6 el 2026-11-16:** M1 y M5 confirmaron que el
destinatario canónico es el `userId` numérico de M1. M5 entrega `clientUserId`
y `driverUserId` numéricos a M6. M6 conservará esos valores y publicará
`DriverArrived` y `TripStarted` en `mobility.events` con `producer: "m6"`,
`data.tripId` y `data.recipientId = clientUserId`. M8 ya inicia una cola propia para ambas
routing keys y sólo acepta `recipientId` como entero positivo seguro.
Falta comprobar los dos eventos contra M6 real en la rama común; el adaptador
local no acredita por sí solo una integración entre módulos. M8 no convierte
`clienteId` libre ni consulta bases ajenas. Los eventos de M6 adicionales de
la tabla inferior se mantienen como propuestas de catálogo.

**Finalización (2026-11-23):** M6 publica `TripCompleted` en `mobility.events`
con routing key `trip.completed`, `data.tripId` y `data.recipientId =
clientUserId` desde su outbox, con `producer: "m6-viajes"`. RF8.6 la liga a
`m8.notifications.trip-events` y acepta `m6` y `m6-viajes` como productores de
M6; RF8.1 crea el aviso "Tu viaje ha finalizado." para el cliente. La misma
routing key la consume Comprobantes en su propia cola (sección 5.6).

**Cancelación después de la asignación (2026-11-23):** M8 ya escucha
`trip.cancelled` en la misma cola. M6 debe publicar `TripCancelled` con el
mismo sobre que `TripCompleted` (`producer: "m6-viajes"`, `correlationId =
tripId`) y un mensaje por destinatario: `data.recipientId` del cliente y, si
había conductor asignado, otro con el del conductor. M8 guarda cada aviso con
`trip_id` (la migración 7 ya lo admite). Pedido enviado a M6.

**Acuerdo M5 del 2026-11-17:** `ride.requested` se correlaciona por
`rideRequestId`; `driver.offer.accepted` se publica después de M6, se
correlaciona por `tripId` y produce un aviso para `clientUserId` y otro para
`driverUserId`; `ride_request.cancelled` se correlaciona por `rideRequestId`
y avisa sólo al cliente. Los tres usan `userId` numérico de M1. El
[contrato M5 → M8](m5-m8-notificaciones.md) explica los esquemas, bindings y el
límite conocido de M5 cuando RabbitMQ cae antes de publicar.

#### 1. Sobre del mensaje (`mobility.events`)

```json
{
  "messageId": "c0a80123-4567-489a-8abc-abcdef123456",
  "eventType": "TripStarted",
  "version": 1,
  "occurredAt": "2026-11-16T20:35:00.000Z",
  "correlationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "producer": "m6",
  "data": {
    "tripId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "recipientId": 42
  }
}
```

* `messageId`: UUID v4 obligatorio, clave de deduplicación.
* `eventType`: Nombre del evento en PascalCase.
* `correlationId`: Debe coincidir con `data.tripId`.
* `occurredAt`: ISO 8601 UTC.
* `data.tripId`: ID único del viaje.
* `data.recipientId`: `userId` numérico de M1 del destinatario (cliente o conductor).
* Para `DriverArrived`, la misma estructura usa `eventType: "DriverArrived"` y
  routing key `driver.arrived`. `TripStarted` usa `trip.started`. M6 indicó que
  `recipientId` será el `clientUserId` numérico en ambos casos.

#### 2. Mapeo de los 6 eventos de viaje

| `eventType` AMQP | Routing Key AMQP | `eventType` RF8.1 | Mensaje Generado por Defecto | Destinatario |
| --- | --- | --- | --- | --- |
| `TripRequested` | `trip.requested` | `TRIP_REQUESTED` | "Tu solicitud de viaje fue recibida." | Cliente |
| `DriverAssigned` | `driver.assigned` | `DRIVER_ASSIGNED` | "Se asignó un conductor a tu viaje." | Cliente |
| `DriverArrived` | `driver.arrived` | `DRIVER_ARRIVED` | "Tu conductor ha llegado al punto de encuentro." | Cliente |
| `TripStarted` | `trip.started` | `TRIP_STARTED` | "Tu viaje ha comenzado." | Cliente |
| `TripCancelled` | `trip.cancelled` | `TRIP_CANCELLED` | "Tu viaje fue cancelado." | Cliente / Conductor |
| `TripCompleted` | `trip.completed` | `TRIP_COMPLETED` | "Tu viaje ha finalizado." | Cliente |

#### 3. Topología de Queue, Bindings y DLX

* **Exchange Principal**: `mobility.events` (topic, durable).
* **Exchange DLX**: `mobility.events.dlx` (topic, durable).
* **Cola Principal Consumer**: `m8.notifications.trip-events` (durable).
  * Argumentos: `x-dead-letter-exchange: mobility.events.dlx`, `x-dead-letter-routing-key: m8.notifications.trip-events`.
* **Cola de Reintentos**: `m8.notifications.trip-events.retry` (durable, sin consumidor).
  * Argumentos: `x-message-ttl: 5000` (5s), `x-dead-letter-exchange: mobility.events`.
* **Cola DLQ**: `m8.notifications.trip-events.dlq` (durable).
  * Binding en `mobility.events.dlx` con routing key `m8.notifications.trip-events`.
* **Bindings activos en `mobility.events`**: la cola M6 escucha
  `driver.arrived` y `trip.started`; la cola M5 escucha `ride.requested`,
  `driver.offer.accepted` y `ride_request.cancelled`.

#### 4. Tratamiento de Resultados de Procesamiento en RF8.1

| Resultado | Criterio / Causa | Acción en DB / Consumer | Respuesta AMQP |
| --- | --- | --- | --- |
| **Nuevo (Éxito)** | Registro inédito de `(consumer_id, message_id)` | Inserta en Inbox, crea la notificación lógica y la entrada en Outbox en 1 transacción DB. | `ACK` manual |
| **Duplicado Idempotente** | Violación de `UNIQUE(consumer_id, message_id)` en Inbox | Se ignora la regeneración de la notificación. | `ACK` manual inmediato |
| **Inválido / Esquema Erróneo** | Falta `messageId`, `tripId`, `recipientId` o `eventType` desconocido | No ingresa a la DB ni al Outbox. Se descarta. | `NACK` (`requeue=false`) → DLQ |
| **Fallo DB / Transitorio** | Pérdida temporal de conexión a PostgreSQL / Timeout | Reencola a `m8.notifications.trip-events.retry` incrementando `x-retry-count`. Si es >= 3 reintentos, va a la DLQ. | `NACK` con reencolado / Retry queue |

### 5.5 `documento.registrado` (M3 → RF8.1)

M3 acordó publicar el hecho externo `DriverDocumentRegistered` en el exchange
`m3.eventos`, con routing key `documento.registrado`. RF8.6 administra la
cola propia `m8.notificaciones.documento-registrado` y entrega únicamente el
envelope validado a RF8.1. Usa `messageId` para el Inbox técnico, confirma
después de RF8.1 y deriva errores a retry o DLQ según corresponda.

RF8.1 crea una notificación lógica con el mensaje “Tu documento fue registrado
correctamente.” y la persiste con su Outbox. El destinatario es `driverId`, que
debe ser el `userId` numérico canónico de M1. El productor M3 publicado en
`b11a471` ya emite el envelope con `driverId` numérico. M3 mostró un mensaje
real que pasa el validador de M8; queda pendiente comprobar que el número
identifique al conductor autenticado en M1 y que ese mensaje haya recorrido
M3 → RabbitMQ → M8 → proveedor PUSH.

La variante de `NotificationRequested` no incluye `tripId` y usa
`DRIVER_DOCUMENT_REGISTERED`; el validador de RF8.7 ya acepta esa variante.
Su proveedor actual es sandbox y la E2E con M3 real sigue pendiente.

El contrato completo está en
[`m3-driver-document-registered.contract.md`](./m3-driver-document-registered.contract.md).

### 5.6 `trip.completed` (M6 → Comprobantes, RF-8.3)

Disparador de la emisión en el Compose común. M6 publica `TripCompleted` al
finalizar un viaje, desde su outbox y en la misma transacción que pasa el viaje
a `COMPLETADO` (`modulo6/src/rf-6.1-6.2-6.3/services/eventos-viaje.service.ts`).
Comprobantes lo recibe en `m8.receipts.trip-completed`, una cola propia: RF-8.6
no la comparte y cada consumidor recibe su copia.

```json
{
  "messageId": "uuid",
  "eventType": "TripCompleted",
  "version": 1,
  "occurredAt": "2026-11-23T15:31:00.000Z",
  "correlationId": "<tripId>",
  "producer": "m6-viajes",
  "data": { "tripId": "<tripId>", "recipientId": 105, "total": 5390.5, "paymentId": "<pagoId>" }
}
```

El evento es delgado: solo identifica el viaje y al cliente (`recipientId`,
`userId` numérico de M1). Comprobantes completa el resto consultando a cada
dueño del dato por REST, sin leer bases ajenas:

| Dato del comprobante | Dueño | Operación |
| --- | --- | --- |
| Estado, cliente, conductor, origen y destino | M6 | `GET /api/viajes/{id}` |
| Inicio, fin, distancia, duración, tipo de vehículo, medio de pago, total y moneda | M6 | `GET /api/viajes?clienteId=&estado=COMPLETADO` (registro RF-6.7, campo `finalizacion`) |
| Vehículo activo del tipo del viaje (patente, marca, modelo) | M3 | `GET /api/v1/drivers/{userId}/vehicles` |
| Alta del conductor (y nombre, si algún día lo informa) | M3 | `GET /api/conductores/{userId}` |
| Estado del pago, medio e importe cobrado | M7 | `GET /metodo-pago/{viajeId}` (sección 5.1) |
| Cliente | M1 vía M6 | `recipientId` del evento |

Decisiones:

- **Nombres.** M1 es el único que guarda nombre y email, y solo los devuelve
  con el token del propio usuario (`GET /auth/me`). M3 guarda del conductor
  `usuarioID`, ciudad y estado, sin nombre. El comprobante emitido desde este
  evento muestra el número de usuario de M1 del cliente y del conductor; no
  inventa datos y no expone datos personales que el dueño no comparte (RNF-23).
  Por REST (`POST /api/v1/receipts`) los nombres siguen siendo obligatorios.
- **Conductor.** `conductorId` de M6 debe ser el `userId` numérico de M1 (como
  lo envía M5 al asignar). Si no lo es, el mensaje va a la DLQ.
- **Pago.** Se aplica la misma regla de 5.1: tarjeta autorizada, o efectivo y
  transferencia pendientes, emiten. Tarjeta pendiente y pago sin registrar se
  reintentan; rechazado va a la DLQ.
- **Tarifa.** M6 informa solo el total; el comprobante no muestra desglose.
  El importe final es el que informa M7.
- **Autorización de acceso.** `customerUserId` = `recipientId` y
  `driverUserId` = `conductorId`: el cliente y el conductor del viaje consultan
  el comprobante con su token de M1 (RF-8.4).

Clasificación de fallas (misma política que 5.1):

| Situación | Resultado |
| --- | --- |
| Sobre inválido, otro `eventType`, `version` distinta, `correlationId` ≠ `data.tripId`, `recipientId` no numérico | DLQ sin reintentos |
| Conductor sin `userId` numérico o medio de pago desconocido | DLQ sin reintentos |
| Pago rechazado en M7, rechazo del autorizador fiscal | DLQ sin reintentos |
| M6, M3, M7, fiscal o PostgreSQL sin respuesta o con `5xx` | Espera en la cola de reintentos sin descontar intentos |
| Viaje todavía no visible como `COMPLETADO`, sin vehículo activo en M3, pago pendiente | Reintento con descuento; agotados, DLQ |
| `messageId` ya procesado, o comprobante ya emitido para el `tripId` | Se descarta sin emitir otro |

Prueba de punta a punta con todos los módulos reales:
`modulo8/tests/e2e/shared-compose-receipt.mjs`.



## 6. Contrato REST interno con Receipts Delivery

Acordado con RF-8.4. No forma parte de la OpenAPI pública.

```
GET /internal/receipts/{tripId}/delivery-reference
```

Devuelve un enlace de descarga temporal del PDF. Receipts Delivery no accede a
la base de datos ni al almacenamiento del servicio de comprobantes.
En la aplicación integrada de AE2, la ruta HTTP exige Bearer validado por M1
y permiso sobre el comprobante (cliente, conductor u operador), igual que la
consulta y descarga. RF8.4 usa directamente la función interna cuando corre
en el mismo proceso; no necesita una credencial entre servicios inventada.

Respuesta `200`:

```json
{
  "data": {
    "tripId": "trip-2026-000123",
    "receiptNumber": "CMP-2026-3176686383",
    "url": "http://localhost:3000/api/v1/receipts/downloads/5f0c1a9e7b2d4c8e",
    "expiresAt": "2026-10-05T18:57:12.000Z"
  }
}
```

| Código | `error.code` | Caso |
| --- | --- | --- |
| 400 | `INVALID_TRIP_ID` | `tripId` con formato inválido. |
| 401 | `AUTH_REQUIRED` / `INVALID_AUTH_TOKEN` | Falta el Bearer o M1 lo rechaza. |
| 403 | `INSUFFICIENT_PERMISSIONS` | El usuario no puede acceder al comprobante. |
| 404 | `RECEIPT_NOT_FOUND` | No hay comprobante emitido para ese viaje. |
| 409 | `RECEIPT_PDF_UNAVAILABLE` | El comprobante existe pero su PDF no. |
| 503 | `DOWNLOAD_LINKS_UNAVAILABLE` | Redis no está disponible; reintentar más tarde. |

El enlace usa un token opaco (32 bytes aleatorios en base64url) que no
contiene ni deriva del `tripId`. Vence según `RECEIPT_LINK_TTL_SECONDS` (por
defecto 900 s). Cada llamada genera un enlace nuevo; los anteriores siguen
vigentes hasta su vencimiento.

Receipts Delivery devuelve `url` y `expiresAt` sin modificarlos en la respuesta
del reenvío (acordado el 2026-10-04). No arma la URL por su cuenta: su base sale
de `PUBLIC_BASE_URL` y cambia según el despliegue.

Al descargar, `GET /api/v1/receipts/downloads/{token}` responde el PDF o
`410 DOWNLOAD_LINK_EXPIRED` si el enlace no existe o ya venció. Redis no
distingue un token vencido de uno inexistente, por eso ambos responden igual.

## 7. Claves de Redis del servicio de comprobantes

Prefijo obligatorio `m8:receipts:`.

| Clave | Contenido | Tiempo de vida | Invalidación |
| --- | --- | --- | --- |
| `m8:receipts:link:<token>` | `tripId` asociado al enlace | `RECEIPT_LINK_TTL_SECONDS` | Expiración automática |

## 8. Procedimiento de cambios

Toda modificación de este catálogo se propone con aviso previo a los módulos
productores y consumidores afectados. Un cambio no comunicado rompe la
integración en ejecución, no en compilación.
