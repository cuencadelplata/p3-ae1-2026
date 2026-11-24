# M5 → M8: solicitudes, asignaciones y cancelaciones

Acuerdo del 17 de noviembre de 2026. M5 publica en el exchange topic durable
`mobility.events`; M8 consume en la cola propia `m8.notifications.m5-events`.
Los tres eventos usan `producer: "m5"`, `version: 1`, `messageId` UUID e
`occurredAt` ISO 8601. `clientUserId` y `driverUserId` son enteros positivos
que representan el `userId` canónico de M1.

## `ride.requested`

M5 publica tras aceptar una solicitud autenticada por M1. `data` incluye
`rideRequestId`, `clientUserId`, `origin`, `destination`, `vehicleType`,
`estimatedFare` y `createdAt`. `correlationId` coincide con `rideRequestId`.
Todavía no existe `tripId`. M8 crea una notificación para el cliente.

## `driver.offer.accepted`

M5 publica después de que M6 confirma creación y asignación. `data` incluye
`rideRequestId`, el `tripId` devuelto por M6, `offerId`, `clientUserId`,
`driverUserId`, `vehicleType` (`AUTO` o `MOTO`), `origin`, `destination` y
`fare` en ARS. Los domicilios de origen y destino vienen en `address`.
`correlationId` coincide con `tripId`. M8 crea dos notificaciones y sus
intenciones Outbox en una transacción de PostgreSQL: una para el cliente y otra
para el conductor. La restricción única `(source_message_id, recipient_id)`
impide duplicarlas ante redelivery. `rideRequestId` vincula el evento con la
solicitud original, mientras la notificación de asignación se asocia a `tripId`.

El aviso al cliente usa el tipo de vehículo y el recorrido. M8 puede agregar
el nombre mediante `GET /auth/usuarios/{driverUserId}/nombre` en M1. Envía
`X-Internal-Api-Key` con la clave compartida `M1_INTERNAL_API_KEY` y usa
`nombre` y `apellido` cuando la respuesta contiene el mismo `userId` numérico.
La consulta tiene un límite de un segundo. Si falla, M8 genera ambos avisos con
los datos disponibles. El cliente recibe el título «Conductor asignado» y el
conductor recibe «Viaje asignado».

Si se configura `M3_VEHICLES_BASE_URL`, M8 consulta opcionalmente
`GET /api/v1/drivers/{driverUserId}/vehicles` en M3-Vehículos. Usa patente,
marca y modelo sólo si el listado contiene exactamente un vehículo con
`driverId` igual al usuario de M1, `activo === true`, `tipoServicio` igual a
`vehicleType` de M5 y los tres campos de presentación. Si la consulta falla o
es ambigua, el aviso conserva sólo el tipo de vehículo. M3 indicó que esta
ruta tampoco requiere token dentro de la red interna. M5 no dispone de
calificación y M3 no la devuelve; no se muestra una calificación por defecto.

## `ride_request.cancelled`

M5 publica una cancelación anterior a la asignación. `data` incluye
`rideRequestId` y `clientUserId`; `correlationId` coincide con `rideRequestId`.
El evento no contiene `tripId` ni destinatario conductor. M8 guarda una
notificación para el cliente con `ride_request_id` y `trip_id = NULL`.

## Fallas, reintentos y límite entre módulos

El consumidor M8 valida routing key, tipo, productor, identificadores y
correlación. Un mensaje inválido va a la DLQ. Para fallas reintentables usa la
cola de retry e Inbox técnico; confirma el mensaje tras guardar los efectos.
Las notificaciones y las intenciones de entrega de M8 se persisten mediante
Outbox propio.

M5 confirmó que **no tiene Outbox transaccional** para estos eventos. Si
RabbitMQ cae antes de recibir una publicación de M5, la operación de
asignación/cancelación puede quedar guardada en M5/M6 sin evento recuperable
para M8. La durabilidad de las colas de RabbitMQ y el Inbox/Outbox de M8 no
reconstruyen un mensaje que nunca llegó al broker. La prueba conjunta debe
mostrar este caso y registrar el resultado.

Pruebas locales: `tests/unit/messaging/m5-trip-events.consumer.test.ts`,
`tests/unit/notifications/m5-notifications.test.ts` y el caso de PostgreSQL en
`tests/integration-db/postgres-notification.repository.integration.test.ts`.
