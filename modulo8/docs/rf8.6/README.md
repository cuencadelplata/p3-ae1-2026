# RF8.6 — Mensajería

RF8.6 administra la conexión RabbitMQ de M8, la validación del envelope,
Inbox, ACK/NACK, reintentos y DLQ. Entrega los hechos a los RF responsables
del negocio; no crea el texto de la notificación ni envía PUSH.

- [Catálogo de eventos](../../contracts/events/catalogo-eventos-v1.md): topología,
  productores, consumidores y estado de cada acuerdo.
- [M3 → documento registrado](../../contracts/events/m3-driver-document-registered.contract.md):
  evento externo que M8 consume y entrega a RF8.1.
- [Índice de contratos por RF](../../contracts/README.md).

M8 consume localmente `DriverArrived` y `TripStarted` de M6 desde
`mobility.events`, con las claves `driver.arrived` y `trip.started`. Ambos
exigen `data.tripId` y `data.recipientId` numérico de M1. La cola propia
`m8.notifications.trip-events` usa Inbox, reintentos y DLQ antes de entregar
el evento a RF8.1. Falta probar el publicador de M6 real en la rama común;
los otros eventos de viaje aún requieren contrato compartido.
