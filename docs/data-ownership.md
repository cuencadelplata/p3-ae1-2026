# Propiedad de datos

| Dato | Owner | ¿M9 guarda? | Motivo |
| --- | --- | --- | --- |
| Reserva y estado | M9 | Sí | agregado propio y fuente de verdad |
| `clienteId` | M1/M2 | Solo referencia | evita replicar perfil del cliente |
| recorrido estimado | M4 | Snapshot mínimo | reproducibilidad de activación/tarifa |
| `requestId` | M5 | Solo referencia | correlaciona reserva con despacho |
| `assignedDriverId` | M3/M5 | Solo referencia | M9 no administra conductores |
| tarifa estimada | M7 | Snapshot + `estimacionId` | M7 conserva el cálculo |
| viaje / `tripId` | M6 | No actualmente | se incorporará solo mediante contrato |
| QR/PDF | M8 | No | documento/notificación fuera de M9 |
| Outbox/Inbox | M9 | Sí | confiabilidad e idempotencia propias |

M9 posee su esquema PostgreSQL y no realiza lecturas SQL cruzadas. Compartir una instancia
física sería posible solo con esquema y permisos aislados; Compose usa una base exclusiva.
