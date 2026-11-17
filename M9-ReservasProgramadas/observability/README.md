# Observabilidad y rendimiento de M9 — AE4

Instrumentación de **M9 — Reservas Programadas** con **OpenTelemetry**, recolección local con
**Grafana Alloy**, visualización y alertas en **Grafana Cloud**, y pruebas de carga con
**Grafana k6**. Sin Prometheus como servidor ni como librería: todas las señales viajan por OTLP.

```
M9 / m5-stub / m7-stub ──OTLP/HTTP──▶ Grafana Alloy ──OTLP/HTTP + token──▶ Grafana Cloud
   (trazas, métricas, logs)            (docker, :4318)                        Tempo · Mimir · Loki
k6 (contenedor o host) ──HTTP──▶ M9          k6 cloud run --local-execution ──▶ Grafana Cloud k6
```

## Documentación

| Documento                                                                 | Contenido                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [01 · Diagnóstico inicial](documentacion/01-diagnostico-inicial.md)       | Línea base antes de AE4, riesgos a medir                   |
| [02 · Arquitectura](documentacion/02-arquitectura.md)                     | Recorrido de cada señal, decisiones, muestreo y costo      |
| [03 · Catálogo de señales](documentacion/03-catalogo-senales.md)          | Métricas, spans y campos de log                            |
| [04 · Guía Grafana Cloud](documentacion/04-guia-grafana-cloud.md)         | Cuenta, tokens, importación de dashboards y alertas        |
| [05 · Alertas](documentacion/05-alertas.md)                               | Umbral, ventana, `for`, No Data/Error, acción              |
| [06 · Pruebas de rendimiento k6](documentacion/06-pruebas-rendimiento.md) | Escenarios, datos, límites, resultados                     |
| [07 · Ensayo de fallas](documentacion/07-ensayo-fallas.md)                | Caída/recuperación controlada y aislada                    |
| [08 · Guion de demostración](documentacion/08-guion-demo.md)              | Demo de 5–10 minutos                                       |
| [09 · Matriz de requisitos](documentacion/09-matriz-requisitos.md)        | Requisito → archivo → comprobación → evidencia → pendiente |
| [10 · Merge M9 ← Parra](documentacion/10-merge-m9-parra.md)               | Comparación de ramas y decisiones del merge                |

## Guía rápida (PowerShell, desde la raíz del repositorio)

Sin cuenta cloud (todo local, telemetría apagada como siempre):

```powershell
npm ci
npm run verify                    # typecheck + lint + format + tests
npm run telemetry:verify-export   # exporta OTLP real a un colector falso local (sin Docker)
npm run obs:dashboards:check      # valida dashboards/alertas contra las métricas reales
```

Con Docker Desktop y Grafana Cloud:

```powershell
Copy-Item M9-ReservasProgramadas/observability/grafana-cloud.env.example `
          M9-ReservasProgramadas/observability/.env.grafana-cloud
notepad M9-ReservasProgramadas/observability/.env.grafana-cloud   # completar (archivo ignorado)
npm run obs:up                    # stack normal + Alloy + OTEL_ENABLED=true
npm run k6:smoke                  # k6 en contenedor dentro de la red Compose
npm run k6:smoke:cloud            # mismo smoke, resultados en Grafana Cloud k6
npm run obs:down
```

El archivo `.env.grafana-cloud` está ignorado por git (`.env.*`). Nunca pegar tokens en chats ni
capturas. El token de k6 es **independiente** del token de ingesta OTLP.
