# Observabilidad de M2: métricas, logs y pruebas de k6

M2 se observa con métricas (Prometheus, enviadas por Grafana Alloy a Grafana Cloud y a un Grafana local) y logs JSON estructurados. Las métricas de RF-2.2 están explicadas en [METRICAS-RF-2.2.md](METRICAS-RF-2.2.md).

## Levantar

Desde `m2/`. El `--build` hace falta: la imagen publicada en Docker Hub no tiene las métricas de RF-2.2.

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d --build
```

Sin las credenciales `GRAFANA_CLOUD_*` en `.env` todo funciona igual; solo no se envían las métricas a Grafana Cloud. En Git Bash (Windows), anteponer `MSYS_NO_PATHCONV=1` a los comandos `run` de k6.

| Qué | Dónde |
|---|---|
| API de M2 / documentación | http://localhost:3000 · http://localhost:3000/docs |
| Métricas crudas de la API | http://localhost:3000/metrics |
| Prometheus local (estado de `api` y `worker`) | http://localhost:59090/targets |
| Grafana local (tablero M2 Clientes) | http://localhost:3001 |
| Alloy (estado de cada componente) | http://localhost:12345 |

## Pruebas de k6

Abreviatura usada abajo: `OBS="-f docker-compose.yml -f docker-compose.observability.yml"`.

| Script | Qué prueba | Comando |
|---|---|---|
| `smoke.js` | 1 usuario, 30 s: que todo responda | `docker compose $OBS run --rm k6 run /scripts/smoke.js` |
| `carga.js` | Carga general de M2 (perfil, direcciones y preferencias para M8), 2 min | `docker compose $OBS run --rm k6 run /scripts/carga.js` |
| `direcciones.js` | **RF-2.2** ciclo completo de favoritas: alta, repetición idempotente, lecturas, edición concurrente, viajes duplicados, baja | `docker compose $OBS run --rm k6 run /scripts/direcciones.js` |
| `direcciones-estres.js` | **RF-2.2 estrés**: sube por escalones hasta 300 pedidos/s (70 % lista, 20 % sugerencias, 10 % alta/baja) | `docker compose $OBS run --rm k6 run /scripts/direcciones-estres.js` |

Para cambiar el pico del estrés: `-e PICO=500`. Todos los resultados de k6 aparecen en la fila **Pruebas de carga (k6)** del tablero, filtrados por `testid`.

## Qué mostrar

### Métricas
Tablero **M2 Clientes**:
- Fila "Métricas del módulo": tráfico y errores, latencia p95 por ruta (filtrar con la variable **Requisito = RF-2.2**) y estado de los circuit breakers.
- Fila "RF-2.2 Direcciones frecuentes": paneles 4 a 11, explicados en [METRICAS-RF-2.2.md](METRICAS-RF-2.2.md).
- Fila "Pruebas de carga (k6)": usuarios virtuales, p95 y fallos vistos desde k6.

### Logs
- `docker compose logs -f api worker`. Cada línea es JSON con `requestId`; los mensajes del worker (`message_processed`, `message_retry`, `message_dead_letter`, `outbox_published`) llevan `queue`, `eventId` y `correlationId`.
- Seguir un pedido: copiar el header `X-Request-Id` de una respuesta y buscarlo con `docker compose logs api | grep <requestId>`.
- Seguir un evento entre procesos: buscar su `correlationId` en los logs de `api` y `worker`.

### Degradación (opcional)
- `docker compose stop redis` → el panel 6 muestra `bypass` y la API sigue respondiendo.
- `docker compose stop rabbitmq` → sube `m2_outbox_pendientes` (panel 10) y baja al volver con `docker compose start rabbitmq`.

## Stack integrado

En el compose de la raíz del repositorio, M2 corre como dos réplicas (`m2-api-1`, `m2-api-2`) detrás de `m2-gateway` (alias `m2-api`, puerto `11000`) y `m2-worker`, contra el M4 real (`m4-api`) y el M6 real (`m6-viajes`). La imagen de M2 se construye con el código de `m2/`. Alloy lee cada réplica y el worker por su nombre si se levanta junto a ese stack.
