# Catálogo de eventos M8 — versión 1 (AE2)

Contrato asíncrono acordado para la AE2. Define la topología de RabbitMQ, el
sobre común de los mensajes y los eventos que produce o consume el servicio de
comprobantes (RF-8.3). Incluye además el contrato REST interno acordado con
Receipts Delivery (RF-8.4), porque forma parte de la misma integración.

Reemplaza a `rabbitmq-ae1.md` para la AE2. Ese archivo se conserva como
evidencia del estado heredado de AE1.

## 1. Registro de acuerdos

| Fecha | Tema | Acordado con | Estado |
| --- | --- | --- | --- |
| 2026-09-29 | Exchange único, convención de nombres y sobre común | Grupo M8 | Acordado |
| 2026-09-29 | Comprobantes consume `payment.confirmed` desde su propia cola | Damián Caminos (RF-8.6) | Acordado |
| 2026-09-29 | Referencia de descarga temporal para reenvíos | Lucas Cremaschi (RF-8.4) | Acordado |
| — | Contenido de `payment.confirmed` | Grupo M7 | Pendiente de confirmación |

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

### Política de versionado

- Agregar campos opcionales a `data` no cambia la versión.
- Quitar, renombrar o cambiar el tipo de un campo requiere incrementar
  `version` y avisar antes a los consumidores.
- Los consumidores ignoran los campos que no conocen.

## 4. Reglas para consumidores

1. **Validación del sobre.** Un mensaje que no respeta el sobre o el esquema de
   su evento se rechaza sin reintento y va directo a la cola de descarte.
2. **Idempotencia.** Antes de aplicar efectos se registra `messageId` en una
   tabla propia del consumidor con restricción de unicidad. Si ya existía, el
   mensaje se confirma sin volver a procesarse.
3. **ACK manual.** Se confirma el mensaje solo después de que el efecto quedó
   persistido.
4. **Reintentos.** Ante un fallo transitorio (base de datos o almacenamiento no
   disponibles) el mensaje se republica en la cola `<cola>.retry` con el
   encabezado `x-retry-count` incrementado y una espera fija
   (`CONSUMER_RETRY_DELAY_MS`, 5 s por defecto); el original se confirma.
   Se reintenta hasta 3 veces (`CONSUMER_MAX_RETRIES`). Superado ese límite, el
   mensaje va a la cola de descarte.
   Si lo que falla es una dependencia (base de datos o un servicio externo caído, o
   con su circuit breaker abierto), el mensaje se republica **sin incrementar**
   `x-retry-count`: espera a que la dependencia vuelva y no llega a la cola de
   descarte por una caída que no es culpa suya.
5. **Cola de descarte.** Los mensajes quedan disponibles para inspección y
   reprocesamiento manual sin bloquear la cola principal.

RabbitMQ garantiza entrega al menos una vez: la regla 2 es la que evita efectos
duplicados ante reconexiones o reintentos.

## 5. Eventos

### 5.1 `payment.confirmed`

| Atributo | Valor |
| --- | --- |
| `eventType` | `PaymentConfirmed` |
| Versión | 1 |
| Productor | M7 — Tarifas, Pagos y Liquidaciones |
| Consumidores | M8 — Comprobantes (`m8.receipts.payment-confirmed`) |
| Estado | **Pendiente de confirmación por M7** |

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
alternativa 1 del punto abierto (abajo), hasta que M7 confirme.

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
conductor y del recorrido, que no son propiedad de M7. Hasta que M7 responda,
se contemplan dos alternativas:

- M7 incluye esos datos en `data`, tomados del viaje que ya conoce.
- M8 consume además `trip.completed` (M6) y emite el comprobante cuando tiene
  ambos eventos del mismo `tripId`.

La decisión se registra en la sección 1 cuando se cierre.

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

## 6. Contrato REST interno con Receipts Delivery

Acordado con RF-8.4. No forma parte de la OpenAPI pública.

```
GET /internal/receipts/{tripId}/delivery-reference
```

Devuelve un enlace de descarga temporal del PDF. Receipts Delivery no accede a
la base de datos ni al almacenamiento del servicio de comprobantes.

Respuesta `200`:

```json
{
  "data": {
    "tripId": "trip-2026-000123",
    "receiptNumber": "CMP-2026-3176686383",
    "url": "http://localhost:3008/api/v1/receipts/downloads/5f0c1a9e7b2d4c8e",
    "expiresAt": "2026-10-05T18:57:12.000Z"
  }
}
```

| Código | `error.code` | Caso |
| --- | --- | --- |
| 400 | `INVALID_TRIP_ID` | `tripId` con formato inválido. |
| 404 | `RECEIPT_NOT_FOUND` | No hay comprobante emitido para ese viaje. |
| 409 | `RECEIPT_PDF_UNAVAILABLE` | El comprobante existe pero su PDF no. |
| 503 | `DOWNLOAD_LINKS_UNAVAILABLE` | Redis no está disponible; reintentar más tarde. |

El enlace usa un token opaco (32 bytes aleatorios en base64url) que no
contiene ni deriva del `tripId`. Vence según `RECEIPT_LINK_TTL_SECONDS` (por
defecto 900 s). Cada llamada genera un enlace nuevo; los anteriores siguen
vigentes hasta su vencimiento.

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
