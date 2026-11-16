# RF8.6 — Mensajería

RF8.6 administra la conexión RabbitMQ de M8, la validación del envelope,
Inbox, ACK/NACK, reintentos y DLQ. Entrega los hechos a los RF responsables
del negocio; no crea el texto de la notificación ni envía PUSH.

- [Catálogo de eventos](../../contracts/events/catalogo-eventos-v1.md): topología,
  productores, consumidores y estado de cada acuerdo.
- [M3 → documento registrado](../../contracts/events/m3-driver-document-registered.contract.md):
  evento externo que M8 consume y entrega a RF8.1.
- [Índice de contratos por RF](../../contracts/README.md).

Los eventos de viaje con M5/M6 siguen pendientes de
un contrato compartido; el catálogo no los convierte por sí solo en una
integración probada.
