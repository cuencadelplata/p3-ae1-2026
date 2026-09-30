# ADR-003: Mensajería con RabbitMQ y estado efímero con Redis (AE2)

* **Estado:** Aceptado
* **Fecha:** 2026-09-30
* **Autor:** Juan Gualtieri (evolución individual AE2)
* **Requerimientos:** RF-8.3, RF-8.4, RF-8.6, RNF-08, RNF-09, RNF-10
* **Reemplaza parcialmente a:** [ADR-001](ADR-001-m8-comprobantes-ae1.md), punto 4 (candado en memoria)
* **Contratos:** [catálogo de eventos v1](../../../../contracts/events/catalogo-eventos-v1.md)

---

## Contexto

En AE1 el comprobante se emitía solo por `POST /api/v1/receipts`: quien confirmaba el
pago tenía que llamar al servicio y esperar a que se generara el PDF. Para AE2 el
comprobante debe emitirse cuando M7 confirma el pago, sin que M7 dependa de que el
servicio de comprobantes esté disponible en ese momento, y el PDF debe entregarse por
un enlace que no se pueda adivinar ni usar indefinidamente.

La cátedra fijó RabbitMQ para la mensajería y aprobó Redis para el estado efímero.
Este ADR registra **cómo** se usan y qué alternativas se descartaron en cada punto.

## Decisión 1: la emisión se dispara por evento, no por llamada síncrona

El servicio consume `payment.confirmed` desde su propia cola
(`m8.receipts.payment-confirmed`), ligada al exchange `mobility.events`.

| Alternativa | Ventaja | Por qué no |
| --- | --- | --- |
| M7 llama a `POST /receipts` (AE1) | Simple, respuesta inmediata | Acopla a M7 con la disponibilidad del servicio y con el tiempo de generación del PDF. Si el servicio cae, M7 debe reintentar por su cuenta. |
| **M7 publica `payment.confirmed` y el servicio lo consume** | M7 no espera ni conoce al consumidor; si el servicio cae, el mensaje espera en la cola | Requiere idempotencia en el consumidor (RabbitMQ entrega al menos una vez) |
| Consumir desde la cola compartida de Soporte (RF-8.6) | Una sola cola para el módulo | Soporte pasaría a ser intermediario del comprobante. Acordado con Damián Caminos: cada consumidor tiene su cola (opción A del catálogo). |

`POST /receipts` se conserva: sirve para pruebas, reemisiones manuales y
compatibilidad con AE1. Ambos caminos usan la misma lógica de emisión.

## Decisión 2: fallos del consumidor con cola de reintentos y DLQ

| Tipo de fallo | Tratamiento |
| --- | --- |
| Mensaje mal formado o contenido inválido | `nack` sin reencolar: va directo a la DLQ. Reintentarlo no cambia el resultado. |
| Fallo transitorio | Se republica en `<cola>.retry` con `x-retry-count` + 1 y un `expiration` de 5 s; al vencer, RabbitMQ lo devuelve a la cola principal. Tras 3 reintentos, a la DLQ. |
| Dependencia caída (base de datos o autorizador fiscal) | Desde 2.1.0: se republica en `<cola>.retry` **sin incrementar** `x-retry-count`, hasta que la dependencia vuelva. Ver [ADR-005](ADR-005-resiliencia-ae2.md). |
| Proceso cortado a mitad del procesamiento | El ACK es manual y se envía al final: RabbitMQ reentrega el mensaje. |

| Alternativa para esperar entre reintentos | Por qué no |
| --- | --- |
| `nack` con reencolado inmediato | Un mensaje que falla siempre se reintenta en bucle y consume CPU sin espera. |
| Esperar en memoria (`setTimeout`) antes del `nack` | El mensaje queda tomado por el consumidor durante la espera y se pierde el conteo si el proceso cae. |
| Plugin `rabbitmq-delayed-message-exchange` | Requiere un plugin que no trae la imagen oficial. |
| **Cola de espera con `expiration` y dead-letter a la cola principal** | Funciona con RabbitMQ estándar y el conteo viaja en el propio mensaje. |

## Decisión 3: `receipt.issued` se publica mediante bandeja de salida

El evento se guarda en `receipts.outbox_events` **en la misma transacción** que el
comprobante y un relay lo publica después, marcándolo recién cuando RabbitMQ confirma
la recepción (publisher confirms).

| Alternativa | Qué falla |
| --- | --- |
| Publicar antes de guardar | Se anuncia un comprobante que puede no llegar a existir si el `INSERT` falla. |
| Publicar después del `COMMIT` | Si el proceso se corta entre ambos pasos, el evento se pierde para siempre: la reentrega de `payment.confirmed` encuentra el comprobante ya emitido y no vuelve a publicar. |
| **Bandeja de salida (outbox)** | Garantiza que todo comprobante guardado termine publicado, aunque RabbitMQ esté caído al emitirlo. Costo: una tabla y un proceso de sondeo cada 1 s. |

Con varias réplicas, `SELECT ... FOR UPDATE SKIP LOCKED` hace que cada evento lo
publique una sola. La entrega es *al menos una vez*: si el proceso cae entre la
confirmación de RabbitMQ y la marca en la base, el evento se republica con el mismo
`messageId` y el consumidor lo descarta.

## Decisión 4: idempotencia del consumidor en dos capas

1. **Bandeja de entrada** (`processed_messages`, por `messageId`): descarta las
   reentregas del mismo mensaje sin volver a procesarlas.
2. **Unicidad por viaje** (`UNIQUE (trip_id)`): cubre dos mensajes *distintos* para el
   mismo viaje y el caso en que el proceso cae después de emitir y antes de registrar
   el mensaje. Ver [ADR-004](ADR-004-persistencia-ae2.md).

La primera capa sola no alcanza (dos `messageId` distintos pasarían); la segunda sola
funcionaría, pero la primera evita regenerar el PDF en cada reentrega.

## Decisión 5: enlace de descarga temporal en Redis

`GET /internal/receipts/{tripId}/delivery-reference` genera un token aleatorio de
32 bytes y guarda `m8:receipts:link:<token> → tripId` con `EX` = `RECEIPT_LINK_TTL_SECONDS`
(900 s). `GET /api/v1/receipts/downloads/{token}` descarga el PDF; vencido, responde 410.

| Alternativa | Por qué no |
| --- | --- |
| URL estática `/files/receipts/<tripId>.pdf` (AE1) | Cualquiera que conozca o adivine un `tripId` descarga el comprobante ajeno, y el enlace no vence. |
| URL firmada (HMAC con vencimiento en la propia URL) | No necesita almacenamiento, pero no se puede revocar un enlace antes de su vencimiento y exige gestionar una clave secreta compartida por las réplicas. |
| Tabla de enlaces en PostgreSQL | Requiere una tarea de limpieza de enlaces vencidos y carga la base con datos que duran minutos. |
| **Token opaco en Redis con TTL** | El vencimiento lo resuelve Redis sin limpieza; un enlace se revoca borrando la clave; lo comparten todas las réplicas. |

Redis guarda **solo** datos efímeros. Si se cae, fallan los enlaces (503) pero la
emisión y la consulta siguen funcionando: por eso figura como dependencia no crítica
en `/health/ready`.

## Consecuencias

* **Positivas:** M7 y el servicio quedan desacoplados en disponibilidad; ningún fallo
  transitorio pierde mensajes; los mensajes inválidos no bloquean la cola; el PDF deja
  de ser accesible por una URL predecible.
* **Negativas:** tres dependencias nuevas que operar (PostgreSQL, RabbitMQ, Redis); la
  emisión por evento es eventualmente consistente (el comprobante aparece
  milisegundos después de publicado el pago); el outbox agrega hasta 1 s de demora a
  `receipt.issued`.
* **Pendiente:** M7 no confirmó aún el contenido de `payment.confirmed`; se implementó
  la alternativa 1 del catálogo de forma provisoria.

## Evidencia

* `tests/integration/payment-confirmed.consumer.test.ts`: reentrega, DLQ, reintentos agotados y recuperación.
* `tests/integration/receipt-issued.outbox.test.ts`: publicación única, RabbitMQ caído y dos relays.
* `tests/integration/download-link.test.ts`: TTL, token opaco y vencimiento (410).
* `tests/e2e/receipts-ae2.e2e.test.mjs` (en `modulo-8`): los mismos flujos contra los contenedores.
