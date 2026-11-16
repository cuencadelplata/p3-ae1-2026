# Métricas de M1 (AE4)

M1 expone sus métricas en `GET /metrics`, en el formato de texto de Prometheus.
Se ven en el navegador en `http://localhost:3001/metrics` y Grafana Alloy las envía a Grafana Cloud (ver `observabilidad/README.md`).

## Las 3 métricas del módulo

Una por requerimiento, cada una a cargo de su integrante:

| # | Métrica | RF | Responsable | Etiquetas | Qué cuenta |
| --- | --- | --- | --- | --- | --- |
| 1 | `m1_logins_total` | RF-1.2 Autenticación | Franco | `resultado`: `exitoso`, `fallido`, `bloqueado` | Logins correctos (200), con contraseña incorrecta (401) y frenados por el rate limit (429) |
| 2 | `m1_validaciones_identidad_total` | RF-1.3 Validación de identidad y rol | Adolfo | `resultado`: `valida`, `usuario_bloqueado`, `usuario_inexistente`, `token_rechazado` | Cada vez que otro módulo le pregunta a M1 quién es el usuario |
| 3 | `m1_credenciales_total` | RF-1.4 Recuperación y revocación | Ana | `operacion`: `recuperacion_solicitada`, `contrasena_reseteada`, `credenciales_revocadas`; `resultado`: `ok`, `error` | Pedidos de recuperación, reseteos de contraseña y revocaciones |

Por qué estas tres: cubren lo que más importa de M1. La 1 muestra la seguridad del login (el rate limit frenando ataques), la 2 muestra cómo usan M1 los demás módulos (es el punto de integración del sistema) y la 3 muestra el ciclo de vida de las credenciales.

Todas arrancan en 0, así el tablero tiene sus líneas desde el inicio.

## Métricas técnicas de soporte

No son métricas de negocio, pero sostienen la demo de resiliencia y el test de estrés:

| Métrica | Qué muestra |
| --- | --- |
| `m1_eventos_credenciales_total{evento,resultado}` | RF-1.4 (Ana): eventos `auth.recuperacion_solicitada` y `auth.credenciales_revocadas` que M1 publicó en RabbitMQ (`publicado`) o que no pudo publicar (`error`) |
| `m1_dependencia_disponible{dependencia}` | 1 o 0 según Redis y RabbitMQ estén conectados |
| `m1_http_request_duration_seconds{metodo,ruta,codigo}` | Tiempo de respuesta de cada ruta (de acá sale el p95) y pedidos por código HTTP |
| `m1_process_*`, `m1_nodejs_*` | Métricas automáticas del proceso de Node (memoria, CPU) |

## Dónde se cuenta cada una

| Métrica | Archivo |
| --- | --- |
| Definición de todas | `src/metrics/metrics.ts` |
| `m1_logins_total` exitoso y fallido | `src/controllers/auth.controller.ts` (función `login`) |
| `m1_logins_total` bloqueado | `src/middleware/login-rate-limit.middleware.ts` |
| `m1_validaciones_identidad_total` | `src/controllers/auth.controller.ts` (función `validateToken`) y `src/middleware/validation-metrics.middleware.ts` (tokens rechazados) |
| `m1_credenciales_total` | `src/controllers/recovery.controller.ts` y `src/controllers/revocation.controller.ts` |
| `m1_eventos_credenciales_total` | `src/messaging/recovery.publisher.ts` |
| `m1_dependencia_disponible` | `src/config/redis.ts` y `src/config/rabbitmq.ts` |
| Duración HTTP y `GET /metrics` | `src/app.ts` |

## Consultas útiles (PromQL)

```promql
# RF-1.2: logins por minuto, por resultado
sum by (resultado) (rate(m1_logins_total[1m])) * 60

# RF-1.3: validaciones por minuto, por resultado
sum by (resultado) (rate(m1_validaciones_identidad_total[1m])) * 60

# RF-1.4: operaciones de credenciales en la última hora
sum by (operacion, resultado) (increase(m1_credenciales_total[1h]))

# RF-1.4: eventos publicados en RabbitMQ por minuto
sum by (evento, resultado) (rate(m1_eventos_credenciales_total[1m])) * 60
```

## Demo rápida

1. **RF-1.2:** 5 logins con contraseña incorrecta y uno más: sube `fallido` a 5 y `bloqueado` a 1.
2. **RF-1.3:** pedir `GET /auth/validar-identidad-y-rol` con un token válido (`valida`) y sin token (`token_rechazado`).
3. **RF-1.4:** pedir una recuperación de contraseña (`recuperacion_solicitada`) y revocar las credenciales (`credenciales_revocadas`).
4. **Resiliencia:** `docker stop m1-redis` pasa Redis a Caído y el login sigue andando; `docker start m1-redis` lo vuelve a Arriba.

## Tests

| Test | Métrica |
| --- | --- |
| `tests/integration/metrics.integration.test.ts` | `m1_logins_total` y que las 3 existan |
| `tests/integration/metrics-validacion.integration.test.ts` | `m1_validaciones_identidad_total` |
| `tests/integration/metrics-credenciales.integration.test.ts` | `m1_credenciales_total` |
| `tests/unit/recovery.publisher.unit.test.ts` | `m1_eventos_credenciales_total` |
| `tests/e2e/rf-1.4-ae4.e2e.test.mjs` | `m1_credenciales_total` y `m1_eventos_credenciales_total` con M1, Redis y RabbitMQ reales |
