# 08 · Guion de demostración (5–10 minutos)

Preparación (antes de la clase): Docker Desktop abierto, `.env.grafana-cloud` completo,
`npm run obs:up` corriendo hace ≥ 2 min, dashboards importados, rango de tiempo “Last 15
minutes”. Tener abiertas: dashboard General, Grafana Cloud k6, UI de Alloy.

| Min  | Qué mostrar                                         | Qué decir                                                                                                                                                                                                   |
| ---- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–1  | Diagrama de [02 · Arquitectura](02-arquitectura.md) | Tres señales por OTLP, una sola vía por señal, Alloy local, sin Prometheus; telemetría apagada por defecto                                                                                                  |
| 1–2  | UI Alloy `localhost:12345`                          | Receptor OTLP → memory_limiter → transform → batch → Grafana Cloud, todo _Healthy_                                                                                                                          |
| 2–4  | `npm run k6:smoke:cloud` + Grafana Cloud k6         | Generador local (`--local-execution`), checks de efectos, p95 por operación con nombres estables                                                                                                            |
| 4–5  | Dashboard **General** mismo rango                   | Tráfico por ruta normalizada `/reservas/:id`, p50/p95/p99, 5xx, health separado, runtime del proceso; variable `RUN_ID k6` filtra los logs de la prueba                                                     |
| 5–6  | Logs de error → `trace_id` → Tempo                  | Correlación log → traza; traza HTTP → servicio → `db …` → `prisma:*` → llamada a `m7-stub`                                                                                                                  |
| 6–8  | `npm run k6:activation` + dashboard **Reservas**    | Traza nueva `scheduler.run`; `publish reservation.ready-for-dispatch.v1` es hija del contexto **persistido en el Outbox**; `process` en `m5-stub`; Inbox PROCESSED; retraso y resolución final por separado |
| 8–9  | Dashboard **Procesamiento**                         | Backlog Outbox, profundidad real de colas, DLQ, hit/miss/**bypass** de caché, locks, M5/M7 stub vs external                                                                                                 |
| 9–10 | Alerta controlada (opcional)                        | `npm run obs:fault-drill -- redis --with-telemetry`: `m9_dependency_up{redis}=0`, `M9DependenciaCaida` Firing → Normal; restauración garantizada                                                            |

Cierre: diferenciar **implementado**, **validado localmente** y **validado en Grafana Cloud**
(ver [09 · Matriz](09-matriz-requisitos.md)); los umbrales son hipótesis a calibrar.
