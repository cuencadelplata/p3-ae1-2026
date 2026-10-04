# Handoff a RF8.6: consumer RabbitMQ heredado de AE1

Support (RF8.5) todavía aloja el consumer RabbitMQ de AE1. El informe base de
arquitectura lo declara deuda que debe pasar a RF8.6. Este documento registra
qué se tocó de ese código desde RF8.5 y qué queda para la extracción.

## Qué pertenece a RF8.6

| Pieza | Ubicación |
| --- | --- |
| Consumer, topología y publicación AE1 | `services/support/src/rabbitmq/consumer.ts` |
| Publicador de prueba `POST /events/publish` | `publicarEvento` en `services/support/src/controllers/support.controller.ts` |
| Contrato AE1 | `contracts/events/rabbitmq-ae1.md` |

RF8.5 no cambia exchange, cola, bindings, routing keys ni la semántica de los
mensajes. ACK/NACK correcto, retry, DLQ, Inbox, envelope y adaptadores quedan
para RF8.6.

## Cambios hechos desde RF8.5

### Robustez ante la caída del broker

Con el baseline `fbc0592`, apagar RabbitMQ terminaba el proceso de Support: el
mensaje se confirmaba dentro del `try` y otra vez dentro del `catch`, y con el
canal cerrado el segundo `ack` lanzaba fuera de todo `try`. Tampoco había
listeners de `error` ni `close`.

El fix mínimo aplicado:

- un único `ack` protegido, sobre el canal que entregó el mensaje;
- listeners `error` y `close` en la conexión y en el canal;
- reconexión con el retardo de 5 s que ya existía, sin timers ni conexiones
  duplicadas.

Se conserva la semántica de AE1: el mensaje se confirma aunque su procesamiento
falle. Pruebas: `src/rabbitmq/consumer.test.ts` y
`pnpm --filter m8-soporte run prueba:resiliencia`.

### Uso asíncrono del repositorio de tickets

En el manejo de `viaje.completado`, el consumer lista los tickets del viaje:

```ts
// antes
const tickets = ticketRepository.listarTodos().filter(t => t.viajeId === payload.viajeId);
// ahora
const tickets = (await ticketRepository.listarTodos()).filter(t => t.viajeId === payload.viajeId);
```

- **Por qué fue necesario:** el contrato del repositorio de tickets pasó a ser
  asíncrono para admitir PostgreSQL, y la línea dejaba de compilar.
- **No cambia el comportamiento:** el resultado sólo se usa para escribir una
  línea de log con la cantidad de tickets del viaje. El callback ya era
  asíncrono.
- **Con PostgreSQL ese log siempre cuenta 0:** desde que los tickets se
  persisten en CommunicationsDB, la instancia en memoria que lee el consumer
  queda vacía en el runtime. No se cambió para no tocar el consumer; el dato
  sólo se usa en ese log.
- **A tener en cuenta en la extracción:** esa línea lee la instancia en memoria
  `ticketRepository`. Es un acceso del consumer a datos de RF8.5 dentro del
  mismo proceso; cuando el consumer salga de Support debe eliminarse o
  reemplazarse por un contrato explícito.

### Desacople del arranque

- `SUPPORT_LEGACY_EVENTS=on|off` (por defecto `on`) controla la conexión del
  consumer, la publicación de `ticket.creado` / `ticket.actualizado` y la
  exposición de `POST /events/publish`.
- Los tickets publican a través de `SupportEventPublisher`; la implementación
  `LegacyRabbitSupportEventPublisher` usa el canal del consumer AE1.
- Con `off`, Support no se conecta al broker y la API de tickets funciona igual.
- **Estado actual:** el flag sigue en `on` por defecto, también en
  `compose.yaml`, porque el E2E global usa `POST /events/publish`. Con `on`,
  `/health/ready` informa `degraded` si el broker está caído; nunca
  `unavailable`.

### Lectura del estado del broker

`consumer.ts` suma `RabbitMQConsumer.isConnected()`, un getter de sólo lectura
que devuelve si hay un canal abierto. Lo usa el readiness de Support. No cambia
el comportamiento del consumer.

Cuando RF8.6 tenga su infraestructura, el camino es: poner el flag en `off`,
retirar `consumer.ts`, `publicarEvento` y los mocks de `src/mocks/`, y, si los
eventos de tickets siguen siendo necesarios, dar otra implementación de
`SupportEventPublisher`.

## Qué depende hoy de lo heredado

- `tests/e2e/workspace-api.e2e.test.mjs`: el caso "Support publica un evento
  historico valido en RabbitMQ" usa `POST /events/publish`.
- El payload de `ticket.creado` y `ticket.actualizado` es el ticket completo.
  Desde RF8.5 incluye `tripId` además de `viajeId` (mismo valor), `version` y
  `fechaActualizacion`; los campos de AE1 se conservan.
