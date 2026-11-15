# Envío de métricas de M1 a Grafana Cloud (AE4)

```
M1 (GET /metrics)  ──cada 15 s──>  Grafana Alloy (contenedor m1-alloy)  ──remote write──>  Grafana Cloud
```

M1 publica sus métricas en `GET /metrics` (ver `../METRICAS.md`). Alloy las lee cada 15 segundos y las manda a Grafana Cloud.
En Grafana Cloud se ven en el tablero `dashboard-m1.json`.

| Archivo | Para qué |
| --- | --- |
| `config.alloy` | Qué lee Alloy (M1) y a dónde lo manda (Grafana Cloud) |
| `dashboard-m1.json` | Tablero para importar en Grafana Cloud |

## 1. Datos de Grafana Cloud

En [grafana.com](https://grafana.com), entrá a tu stack y abrí la tarjeta de **Prometheus** (botón **Details** o **Send metrics**). Ahí están:

- la URL de **Remote Write** (termina en `/api/prom/push`);
- el **Username / Instance ID** (un número);
- la opción de generar un **token** (Access Policy) con permiso `metrics:write`.

Los nombres de los botones pueden variar un poco según la versión de Grafana Cloud.

## 2. Configurar el `.env`

En `modulo-1-identidad-acceso/.env` (no se sube al repo) agregá:

```
GRAFANA_CLOUD_PROM_URL=https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push
GRAFANA_CLOUD_PROM_USER=1234567
GRAFANA_CLOUD_API_KEY=glc_...
```

Si M1 corre con `npm run dev` y no en Docker, agregá también:

```
M1_METRICS_TARGET=host.docker.internal:3001
```

## 3. Levantar Alloy

```
docker compose --profile metricas up -d alloy
```

El perfil `metricas` hace que Alloy arranque solo cuando se pide: un `docker compose up` normal no lo levanta.

Para comprobar que lee a M1: abrir `http://localhost:12345`, entrar a `prometheus.scrape.m1` y ver el target en estado **up**.

## 4. Importar el tablero

En Grafana Cloud: **Dashboards > New > Import**, subir `dashboard-m1.json` y elegir como origen de datos el Prometheus del stack (`grafanacloud-<stack>-prom`).

| Panel | Qué muestra |
| --- | --- |
| Redis / RabbitMQ | Arriba (verde) o Caído (rojo) |
| Logins en el período | Exitosos, fallidos y bloqueados |
| IPs bloqueadas | Veces que una IP llegó al límite |
| Logins por minuto | Evolución por resultado |
| Tiempo de respuesta p95 | Por ruta |
| Pedidos por segundo | Por código HTTP |
| Eventos en RabbitMQ | Publicados `ok` y `error` |
| Memoria de M1 | Memoria del proceso |

Las métricas tardan unos 30 segundos en aparecer: 15 de lectura más el envío.

## Demo

1. Con el tablero abierto, hacer 5 logins fallidos y uno más: el panel de IPs bloqueadas sube a 1 y aparece la línea de `bloqueado`.
2. `docker compose stop redis`: el panel Redis pasa a Caído y el login sigue respondiendo.
3. `docker compose start redis`: vuelve a Arriba sin reiniciar M1.
4. Correr el test de estrés y ver subir los pedidos por segundo y el p95.
