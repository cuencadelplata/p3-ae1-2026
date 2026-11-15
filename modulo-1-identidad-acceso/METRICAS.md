# Métricas de M1 (AE4)

M1 expone sus métricas en `GET /metrics`, en el formato de texto de Prometheus.
Se ven en el navegador en `http://localhost:3001/metrics` y son las que se envían a Grafana Cloud.

## Métricas propias

| Métrica | Tipo | Etiquetas | Qué cuenta |
| --- | --- | --- | --- |
| `m1_logins_total` | counter | `resultado`: `exitoso`, `fallido`, `bloqueado` | Logins por resultado: 200, 401 y 429 |
| `m1_ips_bloqueadas_total` | counter | — | Veces que una IP llegó al límite de intentos fallidos |
| `m1_eventos_publicados_total` | counter | `evento`, `resultado`: `ok`, `error` | Eventos enviados a RabbitMQ (`error` = RabbitMQ no disponible) |
| `m1_dependencia_disponible` | gauge | `dependencia`: `redis`, `rabbitmq` | 1 si está conectada, 0 si no |
| `m1_http_request_duration_seconds` | histogram | `metodo`, `ruta`, `codigo` | Duración de cada respuesta HTTP |

Además están las métricas del proceso de Node con el prefijo `m1_` (CPU, memoria, event loop).

## Dónde se cuenta cada una

| Métrica | Archivo |
| --- | --- |
| Definición de todas | `src/metrics/metrics.ts` |
| `exitoso` y `fallido` | `src/controllers/auth.controller.ts` (función `login`) |
| `bloqueado` | `src/middleware/login-rate-limit.middleware.ts` |
| `m1_ips_bloqueadas_total` | `src/controllers/auth.controller.ts` (función `contarIntentoFallido`) |
| `m1_eventos_publicados_total` | `src/messaging/auth.publisher.ts` |
| `m1_dependencia_disponible` | `src/config/redis.ts` y `src/config/rabbitmq.ts` |
| Duración HTTP y `GET /metrics` | `src/app.ts` |

## Consultas útiles para Grafana (PromQL)

```promql
# Logins por minuto, separados por resultado
sum by (resultado) (rate(m1_logins_total[1m])) * 60

# Tiempo de respuesta p95 del login
histogram_quantile(0.95, sum by (le) (rate(m1_http_request_duration_seconds_bucket{ruta="/auth/iniciar-sesion"}[5m])))

# Estado de Redis y RabbitMQ (1 = arriba, 0 = abajo)
m1_dependencia_disponible
```

## Demo rápida

1. Hacer 5 logins con contraseña incorrecta: `m1_logins_total{resultado="fallido"}` sube a 5 y `m1_ips_bloqueadas_total` a 1.
2. El sexto intento devuelve 429: sube `m1_logins_total{resultado="bloqueado"}`.
3. Apagar Redis (`docker compose stop redis`): `m1_dependencia_disponible{dependencia="redis"}` pasa a 0 y el login sigue respondiendo.
4. Prenderlo (`docker compose start redis`): vuelve a 1 sin reiniciar M1.

## Test

`tests/integration/metrics.integration.test.ts` comprueba que cada contador sube cuando corresponde.
