# ADR-003 — RabbitMQ con Outbox e Inbox

## Contexto

La activación no debe quedar acoplada a una llamada larga ni perderse si el broker cae. La
entrega RabbitMQ es al menos una vez.

## Alternativas

- REST puro: contrato claro, mayor acoplamiento temporal.
- Publicación directa después de guardar: riesgo de dual-write.
- RabbitMQ + Outbox/Inbox: asincronía con persistencia e idempotencia.

## Decisión

Guardar Reserva y Outbox en una transacción. Publicar con confirmación. Procesar resultados
con un `eventId` único y el efecto de negocio en una transacción Inbox. Usar retry con TTL y
DLQ. REST M5 queda disponible, pero Compose selecciona un solo modo.

## Consecuencias

El flujo tolera caídas y duplicados a cambio de consistencia eventual y más componentes.
Los consumers deben ser idempotentes y la operación debe observarse mediante correlationId.
