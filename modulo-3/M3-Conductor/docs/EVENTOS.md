# Eventos asíncronos del Módulo 3 — Conductor y Valoraciones (RNF-07)

Catálogo unificado de los eventos AMQP que **publica** y **consume** `M3-Conductor`.

Semántica de valoraciones: **evaluador = conductor**, **evaluado = pasajero**.

| | |
|---|---|
| **Broker** | RabbitMQ (AMQP 0-9-1), librería [`amqplib`](https://www.npmjs.com/package/amqplib) |
| **Formato** | JSON (`content-type: application/json`), mensajes persistentes |
| **Garantía** | *At-least-once*: publisher confirms donde aplica; consumidores con `ack` manual e idempotencia por `eventId` |
| **Contrato AsyncAPI (valoraciones)** | [`src/api/valoraciones/asyncapi.yml`](../src/api/valoraciones/asyncapi.yml) |
| **Topología valoraciones** | [`src/infraestructure/rabbitmq.topology.js`](../src/infraestructure/rabbitmq.topology.js) |

> Los eventos de **vehículos/documentos** viven en el sibling `m3-vehiculos` (exchange `m3.eventos`) y no se documentan acá.

---

## Mapa rápido

| Rol | Evento / routing key | Exchange | Código |
|---|---|---|---|
| **Publica** | `driver.availability.updated` | `m3.conductores.events` | `src/events/eventPublisher.js` |
| **Publica** | `driver.status.changed` | `m3.conductores.events` | `src/events/eventPublisher.js` |
| **Consume** | `viaje.finalizado` | `viajes.events` | `src/modules/valoraciones/consumers/viajeFinalizado.consumer.js` |
| **Publica** | `valoracion.habilitada` | `valoraciones.events` | `src/modules/valoraciones/ValoracionHabilitada.publisher.js` |

Cola de demo (no es contrato de negocio): `m3.ejemplo.driver-events` → `src/consumers/driverEventsConsumer.js`.

---

## Exchanges

| Exchange | Tipo | Dueño | Uso |
|---|---|---|---|
| `m3.conductores.events` | topic, durable | M3-Conductor | Estado del conductor (RF 3.1 / 3.3) |
| `viajes.events` | topic, durable | M6 (M3 solo consume) | Fin de viaje |
| `valoraciones.events` | topic, durable | M3-Conductor | Habilitar valoración |

Configurable: `RABBITMQ_EXCHANGE` (solo afecta el exchange de conductores; default `m3.conductores.events`).

---

## 1. Eventos de conductor — `m3.conductores.events`

### Sobre común (envelope)

| Campo | Tipo | Descripción |
|---|---|---|
| `eventId` | string (UUID v4) | Idempotencia / deduplicación |
| `eventType` | string | `DriverAvailabilityUpdated` \| `DriverStatusChanged` |
| `eventVersion` | integer | Versión del contrato (`1`) |
| `source` | string | Siempre `M3-Conductor` |
| `occurredAt` | string (ISO-8601, UTC) | Momento del cambio |
| `data` | object | Payload específico |

Propiedades AMQP: `messageId = eventId`, `type = eventType`, `appId = source`, `persistent = true`.

### Flujo

```
Cliente ──PUT /api/conductores/:id/disponible──▶ M3 ──▶ Redis (TTL)
                                                  │
Cliente ──PUT /api/conductores/:id/habilitado───▶ M3 ──▶ DB + caché Redis
                                                  │
                                                  ▼ publish
                                   exchange "m3.conductores.events"
                                                  │
                     ┌────────────────────────────┼─────────────────────────┐
                     ▼                            ▼
          cola m3.ejemplo.driver-events      cola propia de M5 (u otros)
```

Cada consumidor declara **su propia cola** y la bindea; M3 no conoce a sus suscriptores.

### `DriverAvailabilityUpdated`

- **Routing key:** `driver.availability.updated`
- **Disparador:** `PUT /api/conductores/:id/disponible` con `{ "disponible": true | false }`
- Solo se emite si el valor **cambia**. Un heartbeat que repite el mismo valor solo renueva el TTL.

| Campo de `data` | Tipo | Descripción |
|---|---|---|
| `usuarioID` | string | ID del conductor |
| `disponible` | boolean | Nuevo estado |
| `disponibleAnterior` | boolean | Estado previo |

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

> Si la clave de disponibilidad **expira** en Redis (sin heartbeat), el conductor queda no disponible **sin evento**. Antes de asignar un viaje, confirmar con `GET /api/conductores/:id/disponible`.

### `DriverStatusChanged`

- **Routing key:** `driver.status.changed`
- **Disparador:** `PUT /api/conductores/:id/habilitado` con  
  `{ "habilitado": "pendiente" | "activo" | "suspendido" | "rechazado", "motivo"?: string }`

| Campo de `data` | Tipo | Descripción |
|---|---|---|
| `usuarioID` | string | ID del conductor |
| `habilitado` | string | Nuevo estado |
| `habilitadoAnterior` | string | Estado previo |
| `motivo` | string \| null | Motivo opcional |

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

## 2. Eventos de valoraciones

### Flujo

```
M6 ──viaje.finalizado──▶ viajes.events
                              │
                              ▼ bind
                 cola valoraciones.viaje-finalizado
                              │
                              ▼
                         M3 consumer
                              │
              Redis valoracion:pendiente:{viajeId}
                              │
                              ▼ publish valoracion.habilitada
                    valoraciones.events
                         │              │
                         ▼              ▼
          cliente.valoracion-habilitada   valoraciones.notificaciones-panel
          (para M2 / cliente)             (panel SSE de M3)
```

Mapeo de IDs:

| Entrada (`viaje.finalizado`) | Salida (`valoracion.habilitada`) | Quién |
|---|---|---|
| `conductorId` | `evaluadorId` | Conductor (quien valora) |
| `clienteId` | `evaluadoId` | Pasajero (quien es valorado) |

### Consume: `viaje.finalizado`

- **Exchange:** `viajes.events`
- **Routing key:** `viaje.finalizado`
- **Cola M3:** `valoraciones.viaje-finalizado`
- **Publica:** M6 (en este repo: mock `npm run mock:viaje-finalizado`)
- **AsyncAPI:** canal `viaje/finalizado`

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "viaje.finalizado",
  "occurredAt": "2026-10-05T18:30:00Z",
  "data": {
    "viajeId": "viaje-123",
    "conductorId": "conductor-456",
    "clienteId": "cliente-789",
    "finalizadoAt": "2026-10-05T18:30:00Z"
  }
}
```

### Publica: `valoracion.habilitada`

- **Exchange:** `valoraciones.events`
- **Routing key:** `valoracion.habilitada`
- **Colas:** `cliente.valoracion-habilitada`, `valoraciones.notificaciones-panel`
- **Disparador:** procesamiento exitoso de `viaje.finalizado`
- **AsyncAPI:** canal `valoracion/habilitada`

> Nota de envelope: hoy este evento lleva `eventId`, `eventType`, `occurredAt` y `data`.  
> Aún **no** incluye `eventVersion` / `source` como los eventos de conductor (mejora pendiente, no bloqueante).

```json
{
  "eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "eventType": "valoracion.habilitada",
  "occurredAt": "2026-10-05T18:30:01.120Z",
  "data": {
    "viajeId": "viaje-123",
    "evaluadorId": "conductor-456",
    "evaluadoId": "cliente-789",
    "estado": "PENDIENTE",
    "habilitadaDesde": "2026-10-05T18:30:00Z"
  }
}
```

### Fuera de AMQP (hoy)

`POST /api/conductor/valoraciones` registra la nota en Redis (HTTP síncrono) y **todavía no publica** un evento `valoracion.registrada`. Queda como mejora futura del catálogo.

---

## Eventos de valoraciones (`valoraciones.events`)

Además de los eventos de conductor, M3 publica el ciclo de valoraciones en el
exchange topic **`valoraciones.events`** (ver `src/infraestructure/rabbitmq.topology.js`
y el contrato AsyncAPI en `src/api/valoraciones/asyncapi.yml`).

| Evento | Routing key | Disparador |
|---|---|---|
| `valoracion.habilitada` | `valoracion.habilitada` | Consumo de `viaje.finalizado` |
| `valoracion.registrada` | `valoracion.registrada` | `POST /conductor/valoraciones` |

### `valoracion.registrada`

Se emite cuando el conductor **registra** una valoración del pasajero (después
de que la valoración quedó habilitada por el viaje finalizado).

- **Routing key:** `valoracion.registrada`
- **Disparador:** `POST /conductor/valoraciones`
- **Producer:** `src/modules/valoraciones/ValoracionRegistrada.publisher.js`

| Campo de `data` | Tipo | Descripción |
|---|---|---|
| `id` | string | ID de la valoración persistida. |
| `evaluadorId` | string | Conductor que valoró. |
| `evaluadoId` | string | Pasajero evaluado. |
| `valoracion` | number (1–5) | Puntaje. |
| `comentario` | string | Comentario opcional. |
| `viajeId` | string \| null | Viaje asociado, si se envió. |
| `fecha` | string (ISO-8601) | Momento del registro. |
| `estado` | string | Siempre `REGISTRADA`. |

```json
{
  "eventId": "a1b2c3d4-e5f6-4789-a012-3456789abcde",
  "eventType": "valoracion.registrada",
  "eventVersion": 1,
  "source": "M3-Conductor",
  "occurredAt": "2026-10-05T15:10:22.100Z",
  "data": {
    "id": "val_1728138622100",
    "evaluadorId": "cond_002",
    "evaluadoId": "cli_015",
    "valoracion": 5,
    "comentario": "Pasajero puntual",
    "viajeId": "viaje_88",
    "fecha": "2026-10-05T15:10:22.100Z",
    "estado": "REGISTRADA"
  }
}
```

La respuesta HTTP incluye `eventoEmitido: true|false`. Si RabbitMQ no está
disponible, el POST igual responde `201` (la valoración ya quedó guardada).

```bash
curl -X POST "http://localhost:5000/conductor/valoraciones?evaluadorId=cond_002" \
     -H "Content-Type: application/json" \
     -d '{"evaluadoId":"cli_015","valoracion":5,"comentario":"Pasajero puntual","viajeId":"viaje_88"}'
```

---

## Manejo de errores

- **Producer de conductores:** si RabbitMQ no está, la HTTP igual responde `200` (estado ya en Redis/DB) y se loguea el error; la conexión se reintenta en la próxima publicación.
- **Consumer de valoraciones:** mensaje inválido → `nack(requeue=false)`; fallo transitorio (Redis/red) → `nack` con requeue.
- **Consumer de ejemplo (conductores):** `prefetch(1)` + `ack` manual; malformado → `nack(requeue=false)`.

---

## Cómo probarlo

Credenciales Compose: **admin / admin123** (Management UI: http://localhost:15672).

### Conductor

```bash
docker compose up -d --build
docker compose logs -f m3-conductor-consumer

curl -X PUT http://localhost:5000/api/conductores/cond_002/disponible \
     -H "Content-Type: application/json" -d '{"disponible": true}'

curl -X PUT http://localhost:5000/api/conductores/cond_003/habilitado \
     -H "Content-Type: application/json" -d '{"habilitado": "activo", "motivo": "Documentación validada"}'
```

La respuesta incluye `eventoEmitido: true|false`.

### Valoraciones

```bash
cd M3-Conductor
npm run mock:viaje-finalizado
```

Esperado: pendiente en Redis, mensaje en `valoraciones.notificaciones-panel` y `cliente.valoracion-habilitada`, aviso en el panel vía SSE.
