# Contrato RabbitMQ AE1

Este documento describe únicamente el comportamiento ejecutable actual de
`services/support`. No representa un contrato distribuido completo de AE2.

## Topología real

- Exchange: `viajes_exchange`
- Tipo: `topic`
- Cola: `m8_async_events`
- Bindings: `viaje.#` y `ticket.#`
- Prefetch del consumidor: `1`

Support se conecta mediante `RABBITMQ_URL` (por defecto
`amqp://localhost:5672`), declara esa topología y consume de la cola.

## Publicación HTTP de AE1

`POST /events/publish` recibe `routingKey`, `payload` y un `count` opcional
(1 a 50). Publica cada payload en `viajes_exchange`; el controlador añade
`_secuencia` y `_timestamp`. La respuesta informa `enviadosExitosamente`.

El propio servicio también publica `ticket.creado` al crear un ticket y
`ticket.actualizado` al actualizarlo.

## Routing keys observadas

| Routing key | Comportamiento actual del consumidor |
| --- | --- |
| `ticket.creado` | Invoca el mock de notificación PUSH. |
| `ticket.actualizado` | Registra una notificación de cambio de estado. |
| `viaje.asignado` | Invoca el mock de notificación PUSH. |
| `viaje.iniciado` | Invoca el mock de QR. |
| `viaje.completado` | Invoca los mocks de PDF y EMAIL; consulta tickets en memoria. |
| otra bajo los bindings | Se registra como evento procesado. |

Los mensajes se confirman con ACK incluso ante excepciones del procesamiento
actual. No hay contrato de payload versionado más allá del JSON que publiquen
los llamadores; `viaje.completado` usa en la práctica `viajeId` e `importe`.

## Pendiente AE2

No existen aún envelope con `eventId`, inbox/outbox, deduplicación, retry,
DLQ, confirmaciones de publisher ni una semántica durable de errores. Deben
definirse como contratos explícitos antes de implementarse en AE2.
