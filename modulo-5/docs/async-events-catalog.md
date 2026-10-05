# Catálogo de Eventos Asíncronos (RabbitMQ) — Módulo 5

Este documento describe formalmente los eventos asíncronos producidos y consumidos por el **Módulo 5 (Solicitud y Despacho)** a través del broker de mensajería **RabbitMQ**.

---

## 1. Configuración de Mensajería

- **Broker:** RabbitMQ (AMQP 0-9-1)
- **Exchange Principal:** `mobility.events`
- **Tipo de Exchange:** `topic` (Durable)
- **Content-Type:** `application/json`

---

## 2. Catálogo de Eventos Publicados

### Evento: `driver.offer.accepted`
- **Exchange:** `mobility.events`
- **Routing Key:** `driver.offer.accepted`
- **Productor:** Módulo 5 (Solicitud y Despacho)
- **Consumidores:**
  - **Módulo 8 (Notificaciones):** Envío de notificación en tiempo real al cliente y generación de comprobantes.
  - **Módulo de Auditoría / Analítica.**
- **Descripción:** Se emite de forma asíncrona cuando un conductor acepta una oferta vigente y el sistema resuelve con éxito el bloqueo distribuido atómico (asignación única).

#### Estructura del Mensaje (Envelope Estándar):
```json
{
  "messageId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "eventType": "driver.offer.accepted",
  "version": "1.0",
  "occurredAt": "2026-10-05T10:30:00.000Z",
  "correlationId": "req_8a123b4c-1234-4567-8901-abcdef123456",
  "producer": "m5",
  "data": {
    "rideRequestId": "req_8a123b4c-1234-4567-8901-abcdef123456",
    "offerId": "offer_7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "clientUserId": 101,
    "driverUserId": 202,
    "origin": {
      "latitude": -27.4512,
      "longitude": -58.9833,
      "address": "Av. Costanera 1234"
    },
    "destination": {
      "latitude": -27.4722,
      "longitude": -58.9911,
      "address": "San Juan 500"
    },
    "vehicleType": "AUTO",
    "fare": {
      "amount": 2612.23,
      "currency": "ARS"
    }
  }
}
```

---

### Evento: `dispatch.assigned` (Cola Directa de Compatibilidad)
- **Cola:** `dispatch.assigned`
- **Productor:** Módulo 5
- **Descripción:** Notificación simplificada para consumidores punto a punto directos.
- **Payload:**
```json
{
  "eventType": "TRIP_ASSIGNED",
  "requestId": "req_...",
  "offerId": "offer_...",
  "driverId": "drv_101",
  "clientId": "client_1",
  "origin": { "latitude": -27.45, "longitude": -58.98 },
  "destination": { "latitude": -27.47, "longitude": -58.99 },
  "vehicleType": "AUTO",
  "estimatedFare": { "amount": 2612.23, "currency": "ARS" },
  "assignedAt": "2026-10-05T10:30:00.000Z"
}
```

---

### Evento: `dispatch.cancelled`
- **Cola:** `dispatch.cancelled`
- **Productor:** Módulo 5
- **Descripción:** Se emite cuando un cliente cancela su solicitud de viaje antes de ser asignada.
- **Payload:**
```json
{
  "eventType": "REQUEST_CANCELLED",
  "requestId": "req_...",
  "clientId": "client_1",
  "reason": "Cancelado por el cliente antes de la asignación",
  "timestamp": "2026-10-05T10:35:00.000Z"
}
```
