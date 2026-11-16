# Observabilidad y pruebas HTTP de M8

M8 expone métricas Prometheus en `GET /metrics`. Grafana Alloy puede leerlas y enviarlas a Grafana Cloud. El smoke de k6 ejecuta una sola iteración con un usuario virtual; sirve para comprobar rutas y visualizar métricas, **no mide capacidad ni 600 usuarios**.

El recorrido es: **k6 local → API de M8 → `/metrics` → Alloy → Grafana Cloud**. k6 ya corre localmente en Docker y no necesita iniciar sesión en Grafana. Para ver las métricas internas en la nube se usa una cuenta de Grafana Cloud del equipo y un token de escritura para métricas. Subir los resultados propios de k6 a Grafana Cloud k6 es una opción distinta y todavía no está configurada en estos scripts.

## Preparación local

Desde `modulo-8/`, crear `.env` a partir de `.env.example` y reemplazar todos los valores `replace-with-*` con credenciales privadas. Usar las mismas credenciales de RabbitMQ en sus dos URL. Mantener `.env` fuera de Git. Levantar M8 y sus dependencias:

```powershell
pnpm install --frozen-lockfile
pnpm run ensure:stack
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:3000/health/ready
Invoke-WebRequest http://localhost:3000/metrics
```

Si se cambió código de M8, reconstruir la imagen con `docker compose --env-file .env up -d --build m8-app` antes de probar.

## Smoke con k6

Los comandos usan la imagen Docker `grafana/k6:2.4.0`; no hace falta instalar k6 en Windows. Fallan si una comprobación HTTP falla.

| Comando | Comprueba |
| --- | --- |
| `pnpm run smoke:http` | QR, comprobante, soporte, tokens, salud y métricas |
| `pnpm run smoke:qr` | Generación, validación idempotente y bloqueo de otro uso |
| `pnpm run smoke:receipts` | Emisión, PDF, referencia y solicitud de reenvío |
| `pnpm run smoke:support` | Apertura de ticket |
| `pnpm run smoke:delivery` | Alta, lista y baja de token de dispositivo |

RF8.1 y RF8.6 usan RabbitMQ, por lo que estos comandos HTTP no prueban su procesamiento. Para ellos ejecutar la batería E2E de M8 y revisar Inbox, notificación y DLQ. `smoke:delivery` verifica el registro de dispositivos, no afirma que se haya enviado un PUSH.

## Grafana Cloud

Para enviar métricas, obtener de la cuenta de Grafana Cloud del equipo la URL **Prometheus remote write**, el ID numérico de la instancia de métricas y un **Cloud Access Policy token con `metrics:write`**. Colocarlos en el `.env` privado como `GRAFANA_CLOUD_REMOTE_WRITE_URL`, `GRAFANA_CLOUD_USER` y `GRAFANA_CLOUD_TOKEN`, respectivamente. No publicarlos en Git ni en capturas. El contenedor Alloy es opcional y sólo se inicia al pedir el perfil. [Grafana documenta estos tres datos](https://grafana.com/docs/grafana-cloud/send-data/metrics/metrics-prometheus/).

```powershell
docker compose --env-file .env --profile observability up -d alloy
docker compose --env-file .env logs --tail=50 alloy
```

En Grafana Cloud, abrir **Explore** y consultar `http_requests_total{service="m8-app"}` para comprobar que llegan series recientes. Se puede graficar la tasa con `sum by (rf) (rate(http_requests_total{service="m8-app"}[5m]))`. Las métricas HTTP sólo representan rutas HTTP; RF8.1 y RF8.6 requieren sus propias pruebas RabbitMQ. Ver un gráfico en Grafana requiere que Alloy pueda conectar con la nube; el smoke local por sí solo no prueba esa conexión.

Para detener sólo el envío a Grafana: `docker compose --env-file .env --profile observability stop alloy`.

## Pruebas de carga

Definir escenarios separados para rutas de lectura y escritura antes de aumentar VU. Cada emisión de comprobante, QR, ticket o token modifica datos; usar identificadores únicos y una base de prueba. Registrar VU, duración, tasas de error y percentiles de latencia junto con estado de PostgreSQL, Redis y RabbitMQ. El umbral de 600 usuarios corresponde a una prueba posterior, con escenario y criterios de aceptación acordados. El smoke actual no lo acredita.
