# Eventos asíncronos del Módulo 3 (RNF-07)

El Módulo 3 publica eventos de dominio en **RabbitMQ** cada vez que cambia el
estado de un conductor, para que otros módulos (ej. **M5 – matching de viajes**)
reaccionen sin tener que consultar la API de forma periódica (polling).

| | |
|---|---|
| **Broker** | RabbitMQ (AMQP 0-9-1), librería [`amqplib`](https://www.npmjs.com/package/amqplib) |
| **Exchange** | `m3.conductores.events` (tipo `topic`, durable) — configurable con `RABBITMQ_EXCHANGE` |
| **Formato** | JSON (`content-type: application/json`), mensajes persistentes |
| **Garantía** | *At-least-once*: el producer usa *publisher confirms*; los consumidores deben hacer `ack` manual y ser idempotentes usando `eventId` |
| **Producer** | `src/events/eventPublisher.js` |
| **Consumidor de ejemplo** | `src/consumers/driverEventsConsumer.js` (`npm run consumer`) |

## Flujo

```
Cliente ──PUT /api/conductores/:id/disponible──▶ M3 ──▶ Redis (TTL)
                                                  │
Cliente ──PUT /api/conductores/:id/habilitado───▶ M3 ──▶ DB + caché Redis
                                                  │
                                                  ▼ publish (routing key)
                                   exchange topic "m3.conductores.events"
                                                  │
                     ┌────────────────────────────┼─────────────────────────┐
                     ▼ bind "driver.#"            ▼ bind "driver.availability.*"
          cola m3.ejemplo.driver-events      cola de M5 (propia de M5)
                     │                            │
              consumer de ejemplo           matching de viajes
```

Cada módulo consumidor declara **su propia cola** y la bindea con la routing
key que le interesa; así cada uno recibe su copia del evento (pub/sub) y M3 no
necesita conocer a sus suscriptores.

## Sobre común (envelope)

Todos los eventos comparten esta estructura:

| Campo | Tipo | Descripción |
|---|---|---|
| `eventId` | string (UUID v4) | Identificador único. Usar para deduplicar (idempotencia). |
| `eventType` | string | `DriverAvailabilityUpdated` \| `DriverStatusChanged` |
| `eventVersion` | integer | Versión del contrato del evento (actualmente `1`). |
| `source` | string | Siempre `M3-Conductor`. |
| `occurredAt` | string (ISO-8601, UTC) | Momento en que ocurrió el cambio. |
| `data` | object | Payload específico del evento (ver abajo). |

Propiedades AMQP del mensaje: `messageId = eventId`, `type = eventType`,
`appId = source`, `timestamp` (epoch en segundos), `persistent = true`.

---

## `DriverAvailabilityUpdated`

Se emite cuando la **disponibilidad** (RF 3.3, estado efímero en Redis) de un
conductor **cambia de valor**. Un heartbeat que repite el mismo valor sólo
renueva el TTL en Redis y **no** genera evento.

- **Routing key:** `driver.availability.updated`
- **Disparador:** `PUT /api/conductores/:id/disponible` con body `{ "disponible": true | false }`

| Campo de `data` | Tipo | Descripción |
|---|---|---|
| `usuarioID` | string | ID del conductor. |
| `disponible` | boolean | Nuevo estado de disponibilidad. |
| `disponibleAnterior` | boolean | Estado previo (`false` si no había heartbeat vigente). |

```json
{
  "eventId": "4f1c2a8e-3b7d-4c1e-9a52-1d2e3f4a5b6c",
  "eventType": "DriverAvailabilityUpdated",
  "eventVersion": 1,
  "source": "M3-Conductor",
  "occurredAt": "2026-10-05T14:32:10.512Z",
  "data": {
    "usuarioID": "cond_002",
    "disponible": true,
    "disponibleAnterior": false
  }
}
```

> Nota: si la clave de disponibilidad **expira** en Redis por falta de
> heartbeat, el conductor pasa a "no disponible" sin que se emita evento (Redis
> no notifica la expiración). Los consumidores que necesiten precisión deben
> confirmar con `GET /api/conductores/:id/disponible` antes de asignar un viaje.

---

## `DriverStatusChanged`

Se emite cuando el **estado de habilitación** (RF 3.1, persistido en la base de
datos) de un conductor **cambia de valor**.

- **Routing key:** `driver.status.changed`
- **Disparador:** `PUT /api/conductores/:id/habilitado` con body
  `{ "habilitado": "pendiente" | "activo" | "suspendido" | "rechazado", "motivo"?: string }`

| Campo de `data` | Tipo | Descripción |
|---|---|---|
| `usuarioID` | string | ID del conductor. |
| `habilitado` | string | Nuevo estado: `pendiente`, `activo`, `suspendido`, `rechazado`. |
| `habilitadoAnterior` | string | Estado previo. |
| `motivo` | string \| null | Motivo opcional del cambio (ej. licencia vencida). |

```json
{
  "eventId": "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "eventType": "DriverStatusChanged",
  "eventVersion": 1,
  "source": "M3-Conductor",
  "occurredAt": "2026-10-05T14:35:42.007Z",
  "data": {
    "usuarioID": "cond_003",
    "habilitado": "activo",
    "habilitadoAnterior": "pendiente",
    "motivo": "Documentación validada"
  }
}
```

---

## Manejo de errores

- **Producer:** si RabbitMQ no está disponible, la operación HTTP igual responde
  `200` (el estado ya quedó guardado en Redis/DB) y el error se registra en el
  log. La conexión se reabre automáticamente en la próxima publicación.
- **Consumer de ejemplo:** `prefetch(1)` + `ack` manual tras procesar. Un mensaje
  malformado se rechaza con `nack(requeue=false)` para no generar un loop
  infinito de reentregas.

## Cómo probarlo

```bash
docker compose up -d --build
docker compose logs -f consumer       # en otra terminal

curl -X PUT http://localhost:5000/api/conductores/cond_002/disponible \
     -H "Content-Type: application/json" -d '{"disponible": true}'

curl -X PUT http://localhost:5000/api/conductores/cond_003/habilitado \
     -H "Content-Type: application/json" -d '{"habilitado": "activo", "motivo": "Documentación validada"}'
```

La respuesta incluye `eventoEmitido: true|false` indicando si hubo cambio y se
publicó el evento. Los mensajes también se pueden inspeccionar en el panel de
RabbitMQ: <http://localhost:15672> (usuario `guest`, contraseña `guest`).
