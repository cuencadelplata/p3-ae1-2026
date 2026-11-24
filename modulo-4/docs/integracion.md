# Integracion de M4 con los demas modulos

Resumen de quien usa a M4 y a quien usa M4 dentro del stack comun (`docker-compose.yml` de la raiz).
El contrato completo de cada endpoint esta en [`openapi/openapi-m4.yaml`](../openapi/openapi-m4.yaml).

## Modulos que consultan a M4 (HTTP)

| Modulo | Endpoint de M4 | Para que | Donde esta en su codigo |
| --- | --- | --- | --- |
| M5 Despacho | `GET /api/v1/drivers/nearby` | Buscar conductores libres cerca del pasajero (`maxCandidates`, `radiusKm`, `vehicleType`) | `modulo-5/src/services/m4-client.service.ts` |
| M6 Viajes | `POST /api/v1/estimate` | Distancia y ETA del recorrido al finalizar el viaje | `modulo6/src/rf-6.1-6.2-6.3/services/finalizacion.service.ts` |
| M9 Reservas | `POST /api/v1/geocode` y `POST /api/v1/estimate` | Resolver la ruta y la distancia de una reserva programada | `M9-ReservasProgramadas/src/clients/m4-route.resolver.ts` |
| M2 Perfil | `POST /api/v1/geocode` | Convertir las direcciones guardadas del pasajero en coordenadas | `m2/src/direcciones/routes.ts` |
| App del conductor | `PUT` y `DELETE /api/v1/drivers/{driverId}/location` | Publicar o borrar la ubicacion actual (requiere token de M1) | Paso 4 de `tests-integracion/flujo-completo.e2e.mjs` |

URL de M4 dentro de la red de Docker: `http://m4-api:3004/api/v1`. Cada modulo la recibe por su propia variable
(`M6_M4_URL`, `M4_SERVICE_URL`, `M2_M4_BASE_URL`, etc.).

## Modulos que consulta M4

| Modulo | Para que | Variable |
| --- | --- | --- |
| M1 Identidad | Validar que el token sea de un CONDUCTOR y que coincida con el `driverId` antes de guardar la ubicacion (`/auth/validar-identidad-y-rol`) | `M1_URL` |

`M3_URL` esta configurada en el compose pero M4 no la consulta todavia: solo se informa en el log de arranque.

## Eventos (RabbitMQ)

| Direccion | Exchange | Routing key | Efecto en M4 |
| --- | --- | --- | --- |
| M6 -> M4 | `trip.events` | `viaje.iniciado` | El conductor pasa a ocupado y deja de aparecer en `/drivers/nearby` |
| M6 -> M4 | `trip.events` | `viaje.finalizado` | El conductor vuelve a estar disponible |
| M6 -> M4 | `trip.events` | `viaje.cancelado` | El conductor vuelve a estar disponible |
| M4 -> | `driver.events` | `driver.availability_changed` | Aviso de cambio de disponibilidad. Hoy ningun modulo lo consume |

Los eventos repetidos se descartan por `eventId` (idempotencia) y los mensajes invalidos o que fallan
varias veces van a la cola `m4.dlq`.

## Como verificarlo

- Salud de M4 y del resto del stack: `node tests-integracion/salud.mjs` (desde la raiz).
- Viaje completo pasando por M4: `node --test tests-integracion/flujo-completo.e2e.mjs`, pasos 4, 6, 8 y 9.
