# Auditoría OpenAPI e integración — M9 AE2

## Fuentes

- M5: `openapi-m5.yaml` externo, versión 4.0.0.
- M7: OpenAPI externo con `POST /tarifa/estimacion`.
- M9: `M9-ReservasProgramadas/openapi/openapi.yaml`, versión 2.0.0.

## M7

M9 consume `POST /tarifa/estimacion` mediante adapter. Convierte `AUTO/MOTO` a
`auto/moto`, envía recorrido, aplica timeout y guarda solo el snapshot/estimación. M7 sigue
siendo owner del cálculo.

## M5 síncrono

El cliente conserva `POST /api/v1/ride-requests`, GET por ID y cancelación, con Bearer,
Idempotency-Key durable, timeout y correlationId. No se consumen tablas M5.

## M5 asíncrono

El OpenAPI entregado no define eventos RabbitMQ. Para demostrar RNF-07 se implementó un
contrato local explícito con stub: `reservation.ready-for-dispatch.v1` y
`ride-request.assigned.v1`/`failed.v1`. No se presenta como contrato oficial; su aprobación
queda `BLOCKED_EXTERNAL_CONTRACT`.

## RF-9.7

El DTO M5 no recibe `MEJOR_CALIFICACION` ni expone reasignación posterior. M9 no implementa
ranking, ofertas o aceptación porque pertenecen a M5. Estado:
`BLOCKED_CONTRACT_M5_SELECTION_POLICY`.

## Coherencia M9

La especificación propia documenta solo endpoints M9, errores y ejemplos. Los eventos se
documentan en `event-catalog.md`, porque OpenAPI describe HTTP, no el contrato AMQP.
