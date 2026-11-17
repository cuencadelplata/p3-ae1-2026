# 04 · Guía Grafana Cloud (pasos en tu cuenta)

> Estado: **pendiente de verificación externa**. Todo lo local está implementado y validado;
> estos pasos requieren tu cuenta. No pegues tokens en chats, issues ni capturas.

## 0. Cuotas (verificar antes de probar)

Plan gratuito según fuentes consultadas el 2026-11-16 (Grafana y terceros; **confirmar en
grafana.com/pricing y en _Administration → Cost management / Usage_ de tu stack**): ~10 000
series activas, 50 GB/mes de logs y de trazas, 14 días de retención y 500 VUh/mes de k6.
Estimación de esta demo: M9 + 2 stubs generan del orden de cientos de series (etiquetas
acotadas). El smoke k6 (2 VUs × 30 s) consume ≈ 0,02 VUh; carga 10 VUs × 3 min ≈ 0,5 VUh.
Estrés/pico prolongados solo como ejecución explícita.

## 1. Credenciales de ingesta OTLP (Alloy)

1. Grafana Cloud Portal → tu stack → **OpenTelemetry** → _Configure_.
2. Copiar el **endpoint OTLP** (`https://otlp-gateway-prod-<región>.grafana.net/otlp`) y el
   **Instance ID**.
3. _Generate now_ → crea un Access Policy token. Permisos mínimos: **`metrics:write`,
   `logs:write`, `traces:write`** (sin permisos de lectura).
4. En PowerShell, desde la raíz:

```powershell
Copy-Item M9-ReservasProgramadas/observability/grafana-cloud.env.example `
          M9-ReservasProgramadas/observability/.env.grafana-cloud
notepad M9-ReservasProgramadas/observability/.env.grafana-cloud
git status --short   # .env.grafana-cloud NO debe aparecer (está ignorado)
```

## 2. Levantar con observabilidad

```powershell
npm run obs:alloy:fmt   # valida la sintaxis de config.alloy con la imagen de Alloy
npm run obs:config      # valida la composición combinada
npm run obs:up          # postgres, redis, rabbitmq, stubs, M9 y Alloy
docker compose -f M9-ReservasProgramadas/docker-compose.yml -f M9-ReservasProgramadas/docker-compose.observability.yml ps
```

- UI de Alloy: <http://localhost:12345> → todos los componentes en verde (_Healthy_).
- Generar tráfico: `npm run k6:smoke`.

## 3. Verificar ingesta (Explore)

| Señal    | Data source                   | Consulta                                                                                                 |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Métricas | `grafanacloud-<stack>-prom`   | `sum by (http_route) (rate(http_server_request_duration_seconds_count{service_name="m9-reservas"}[5m]))` |
| Catálogo | idem                          | _Metrics browser_ filtrando `m9_` (confirmar nombres de [03](03-catalogo-senales.md))                    |
| Logs     | `grafanacloud-<stack>-logs`   | `{service_name="m9-reservas"} \| message="http_request"`                                                 |
| Trazas   | `grafanacloud-<stack>-traces` | TraceQL `{ resource.service.name = "m9-reservas" }`                                                      |

Si un nombre difiere del catálogo (p. ej. sufijos de unidad), corregirlo en
`scripts/build-grafana-dashboards.mjs`, regenerar con `npm run obs:dashboards:build` y
volver a correr `npm run obs:dashboards:check`.

## 4. Importar dashboards

_Dashboards → New → Import → Upload JSON_ para cada archivo de
`observability/grafana/dashboards/`: `m9-general.json`, `m9-reservas.json`,
`m9-procesamiento.json`. Elegir en las variables `datasource` / `loki` / `tempo` los data
sources `grafanacloud-<stack>-prom`, `-logs` y `-traces`. UID fijos: `m9-ae4-general`,
`m9-ae4-reservas`, `m9-ae4-procesamiento` (los enlaces entre dashboards los usan).

## 5. Correlación log → traza → log

1. _Connections → Data sources → `grafanacloud-<stack>-logs` → Derived fields → Add_:
   tipo **Label** (structured metadata), nombre `trace_id`, _Internal link_ → data source de
   trazas, consulta `${__value.raw}`. (Si tu stack ya trae el enlace configurado, solo verificar.)
2. Data source de trazas → _Trace to logs_: data source de logs, tags
   `service.name → service_name`, activar _Filter by trace ID_.
3. Prueba: panel “Logs de error de M9” → abrir un log → botón de `trace_id` → traza en Tempo.

## 6. Alertas

Opción A (importable, data source-managed) con `mimirtool` y un token con `rules:write`:

```powershell
mimirtool rules load M9-ReservasProgramadas/observability/grafana/alerts/m9-alertas.rules.yaml `
  --address=https://prometheus-prod-<región>.grafana.net --id=<usuario-métricas> --key=$env:MIMIR_RULES_TOKEN
```

Opción B (Grafana-managed, con control de No Data/Error): crear cada regla en _Alerting →
Alert rules → New_ siguiendo la tabla de [05 · Alertas](05-alertas.md).
**No configurar contact points de terceros** sin decisión del equipo.
Alerta controlada para la demo: detener Redis en el ensayo aislado (ver [07](07-ensayo-fallas.md))
con `--with-telemetry` y observar `M9DependenciaCaida` pasar a _Firing_ y volver a _Normal_.

## 7. Grafana Cloud k6 (token independiente)

1. _Testing & synthetics → Performance → Settings_: crear **Grafana Stack API token** (o
   personal token). Anotar **Stack ID** y el **Project ID** del proyecto destino.
2. Completar `K6_CLOUD_TOKEN`, `K6_CLOUD_STACK_ID`, `K6_CLOUD_PROJECT_ID` en
   `.env.grafana-cloud`. El runner pasa a k6 **solo** esas tres variables.
3. `npm run k6:smoke:cloud` → `k6 cloud run --local-execution --no-archive-upload`: la carga
   se genera en esta PC (los generadores cloud no alcanzan `localhost`) y solo se suben los
   resultados. No se suben scripts y no se publica la API con túneles.
4. Comparar la ventana del test en Grafana Cloud k6 con los dashboards de M9 (mismo rango de
   tiempo; variable `RUN_ID k6` del dashboard General para filtrar logs por `correlationId`).
