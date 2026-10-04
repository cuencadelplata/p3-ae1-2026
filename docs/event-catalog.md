# Catálogo de eventos M9 AE2

Contrato local de demostración AE2. El contrato RabbitMQ definitivo con M5 permanece
`BLOCKED_EXTERNAL_CONTRACT` hasta aprobación del equipo responsable de M5.

## Envelope común

`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `aggregateId` y
`payload`. Los IDs son UUID; no se transportan perfiles ni datos personales innecesarios.

## `reservation.ready-for-dispatch.v1`

- Productor/consumidor: M9 → M5 (stub local).
- Exchange/routing key: `m9.reservas.events` / mismo nombre del evento.
- Propósito: informar que una reserva alcanzó su horario y fue reclamada atómicamente.
- Payload obligatorio: `reservationId`, `status=ACTIVANDO`, `vehicleType`, `route`,
  `idempotencyKey`.
- Confiabilidad: Outbox transaccional, publisher confirm y eventId único.

```json
{"eventId":"10000000-0000-4000-8000-000000000001","eventType":"reservation.ready-for-dispatch.v1","eventVersion":1,"occurredAt":"2026-10-04T20:00:00.000Z","correlationId":"demo-1","aggregateId":"20000000-0000-4000-8000-000000000001","payload":{"reservationId":"20000000-0000-4000-8000-000000000001","status":"ACTIVANDO","vehicleType":"AUTO","route":{"origin":{"latitude":-27.45,"longitude":-58.98,"address":"Terminal"},"destination":{"latitude":-27.47,"longitude":-58.83,"address":"Aeropuerto"},"distanceKm":18.4,"estimatedDurationMin":28},"idempotencyKey":"30000000-0000-4000-8000-000000000001"}}
```

## `ride-request.assigned.v1`

- Productor/consumidor: M5 (stub local) → M9.
- Exchange/routing key: `m9.reservas.events` / mismo nombre del evento.
- Payload: `reservationId`, `requestId`, `assignedDriverId`.
- Efecto: Inbox + transición `ACTIVANDO→ACTIVADA` en una transacción PostgreSQL.

## `ride-request.failed.v1`

- Productor/consumidor: M5 (stub local) → M9.
- Payload: `reservationId`, `requestId`, `reason` (`EXPIRED` o
  `NO_DRIVERS_AVAILABLE`).
- Efecto: Inbox + transición `ACTIVANDO→FALLIDA`.

## Política común

- Main queue → error → retry exchange/queue con TTL → main exchange.
- `RABBITMQ_RETRY_LIMIT` limita reentregas; luego el mensaje va a DLQ.
- `x-retry-count` registra intentos. No hay bucles infinitos.
- M9 confirma (`ACK`) solo después de completar la transacción de Inbox; un error produce
  retry. Un `eventId` repetido se confirma sin repetir el efecto.
