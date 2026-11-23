# Métricas de RF-2.2 Direcciones frecuentes

Las métricas generales de M2 (tráfico, latencia, circuit breakers) ya mostraban si la API responde, pero no si RF-2.2 hace lo que promete. Estas métricas miden eso: que las favoritas no se dupliquen, que la caché sirva, que las sugerencias sean útiles y que los viajes completados lleguen como recientes.

Se ven en la fila **RF-2.2 Direcciones frecuentes** del tablero `M2 Clientes` (paneles 4 a 11).

## Qué se mide y por qué

| Métrica | Etiquetas | Qué responde | Requisito |
|---|---|---|---|
| `m2_direcciones_operaciones_total` | `operacion` (alta, edicion, baja), `resultado` | ¿Cuántas altas, ediciones y bajas se aplicaron, cuántas eran repeticiones (`replay`) y cuántas se rechazaron por duplicada, versión vieja (412) o choque concurrente (409)? | RF-2.2, RNF-08, RNF-09 |
| `m2_direcciones_reintentos_transaccion_total` | `resultado` (reintento, agotado) | ¿Cuántas veces chocaron dos escrituras y se resolvió sola la transacción serializable, y cuántas llegaron al cliente como 409? | RNF-09 |
| `m2_direcciones_cache_total` | `resultado` (hit, miss, bypass) | ¿Qué porcentaje de las listas se sirve desde Redis? `bypass` = Redis caído y se sirvió igual desde PostgreSQL. | RNF-06 |
| `m2_direcciones_sugerencias_total` | `regreso` (si, no) | ¿Qué parte de las sugerencias ofrece el viaje de regreso B → A? | RF-2.2 |
| `m2_direcciones_sugerencias_candidatos` | — (histograma) | ¿Cuántas direcciones se ofrecen para elegir? El bucket `le="0"` cuenta las sugerencias vacías. | RF-2.2 |
| `m2_direcciones_viajes_recientes_total` | `via` (rest, evento_m2, evento_m6), `resultado` (nuevo, duplicado, error) | ¿Cuántos viajes completados se convirtieron en recientes y cuántos se ignoraron por llegar repetidos? | RF-2.2, RNF-08 |
| `m2_geocodificacion_duracion_segundos` | `resultado` (ok, error) | ¿Cuánto tarda M4 en geocodificar y cuántas búsquedas fallan? | RF-2.2 / integración con M4 |
| `m2_mensajes_consumidos_total` | `cola`, `resultado` (procesado, reintento, dlq, contrato_invalido) | ¿Cuántos `TripCompleted` se procesaron, cuántos se reintentaron y cuántos terminaron en la DLQ? | RNF-07 |
| `m2_mensajes_procesamiento_segundos` | `cola` | ¿Cuánto tarda el worker en procesar cada mensaje? | RNF-07 |
| `m2_outbox_pendientes` | — (gauge) | ¿Cuántos `FavoriteAddressChanged.v1` están guardados pero todavía no se publicaron? Si crece, el worker o RabbitMQ están caídos. | RNF-07 |
| `m2_outbox_publicados_total` / `m2_outbox_demora_segundos` | `tipo` / — | ¿Cuántos eventos salieron hacia M8 y cuánto tardaron desde el cambio hasta la publicación? | RNF-07 |

Ninguna métrica lleva `clienteId`, `viajeId` ni la dirección como etiqueta: serían datos personales en el sistema de métricas (RNF-23) y además crearían una serie nueva por cliente.

## Dónde se registran

- `src/observability/metrics.ts`: definición de todas las métricas (mismo registro que las generales).
- `src/direcciones/service.ts`: operaciones, reintentos de transacción, caché, sugerencias y viajes recientes.
- `src/direcciones/routes.ts`: geocodificación con M4.
- `src/messaging/broker.ts`: consumo de mensajes.
- `src/worker.ts`: outbox. El worker no tiene API HTTP, así que expone solo `GET /metrics` en el puerto `9464` (`WORKER_METRICS_PORT`). Alloy lo lee junto con la API y lo identifica como `instance="worker"`.

## Cómo generar datos para el tablero

Con el compose principal y el de observabilidad levantados (desde `m2/`):

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
docker compose -f docker-compose.yml -f docker-compose.observability.yml run --rm k6 run /scripts/direcciones.js
```

`load/k6/direcciones.js` recorre el ciclo de una favorita (alta, repetición idempotente, lecturas, dos ediciones simultáneas con la misma versión, baja), publica viajes completados repetidos por el simulador de M6 y consulta la geocodificación. Así aparecen en el tablero tanto los casos normales como los rechazos esperados.

Para la prueba de estrés de RF-2.2 (sube hasta 300 pedidos/s): `run --rm k6 run /scripts/direcciones-estres.js`. Más detalle en [OBSERVABILIDAD.md](OBSERVABILIDAD.md).

Para ver la degradación: `docker compose stop redis` (sube `bypass` en el panel 6) o `docker compose stop rabbitmq` (sube `m2_outbox_pendientes` en el panel 10 hasta que vuelve).

## Consultas útiles

```promql
# Porcentaje de aciertos de caché en la última hora
sum(increase(m2_direcciones_cache_total{resultado="hit"}[1h])) / sum(increase(m2_direcciones_cache_total[1h]))

# Repeticiones absorbidas por idempotencia en la última hora
sum(increase(m2_direcciones_operaciones_total{resultado="replay"}[1h]))

# Mensajes enviados a la DLQ en la última hora
sum(increase(m2_mensajes_consumidos_total{resultado="dlq"}[1h]))
```
