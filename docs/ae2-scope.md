# Alcance individual AE2 — M9 Reservas Programadas

## Línea base y autoría

- Branch individual: `M9-AE2-Parra`.
- Tag grupal observable: `v1.0.0`, commit `9f9b2a6`.
- Commit desde el que se abrió el trabajo actual: `c900128`.
- Base oficialmente aceptada por la cátedra: `PENDIENTE_CONFIRMAR_BASE_AE1`.
- Responsable de esta evolución individual: Ignacio Parra Ingaramo.

El historial demuestra una base grupal 1.x, pero el repositorio no contiene una evidencia
inequívoca de cuál commit fue aceptado académicamente. No se reconstruyeron fechas ni
commits anteriores.

## Alcance comprometido

Se evoluciona M9 sin asumir responsabilidades de M5, M7 o M8:

- RF-9.1 a RF-9.6: crear, consultar, modificar, cancelar, activar reservas y consultar
  tarifa estimada.
- Persistencia propia PostgreSQL mediante Prisma.
- Redis como cache-aside y coordinación efímera, nunca como fuente de verdad.
- Dos flujos RabbitMQ de activación: M9→M5 y M5→M9.
- Transactional Outbox, Inbox durable, publisher confirms, retry y DLQ.
- Idempotency-Key durable, transiciones condicionales y caso cancelación vs activación.
- Contratos OpenAPI, logs correlacionados, readiness y pruebas reproducibles.

RNF priorizados: RNF-04, 05, 06, 07, 08, 09, 10, 11, 13, 16, 17 y 22.

## Estado heredado y evolución

La base heredada tenía CRUD, scheduler, OpenAPI, Docker, tests y persistencia en memoria.
El trabajo AE2 reemplaza el repositorio productivo por PostgreSQL, conserva los puertos de
dominio, incorpora mensajería funcional y hace durable la consistencia que antes dependía
del proceso.

## Dependencias

- M5: despacho. El contrato REST oficial se conserva; los eventos son un contrato de
  demostración AE2 con stub hasta que M5 acuerde el contrato asíncrono.
- M7: estimación de tarifa por REST según su OpenAPI.
- M4: resolución real de recorrido pendiente; Compose usa un stub configurable.
- M1: identidad/token de servicio definitivo pendiente.

## Fuera de alcance

- RF-9.7 queda `BLOCKED_EXTERNAL_CONTRACT`: la prioridad por mejor calificación es de M5 y
  su OpenAPI no acepta ese criterio.
- QR y PDF pertenecen a M8: `PENDIENTE_CONFIRMACION_ACADEMICA`.
- Cloud, HA, CI/CD completo, métricas Grafana/Prometheus y Circuit Breaker corresponden a
  AE4.

## Evidencias esperadas

Código, migración, catálogo de eventos, ADR, diagramas, pruebas unitarias/integración/
infraestructura/E2E, cobertura, Compose y logs correlacionados. Las validaciones que
requieren Docker se registran como `BLOCKED_DOCKER_DAEMON` hasta ejecutarlas realmente.
