# 05 · Alertas

Fuente importable: `observability/grafana/alerts/m9-alertas.rules.yaml` (formato
Prometheus/Mimir). Para reglas **Grafana-managed** usar esta tabla. Los umbrales son
**hipótesis iniciales** a calibrar con las mediciones de k6; no son SLA aprobados ni
exigencias del docente. Sin notificaciones a terceros.

| Alerta                     | Consulta (resumen)                                                  | Umbral   | Ventana     | `for` | No Data                                  | Error | Interpretación                                      | Acción                                                             |
| -------------------------- | ------------------------------------------------------------------- | -------- | ----------- | ----- | ---------------------------------------- | ----- | --------------------------------------------------- | ------------------------------------------------------------------ |
| **M9Http5xxSostenido**     | 5xx / total en `m9_route_kind="business"` **y** volumen > 0.1 req/s | > 5 %    | 5m          | 5m    | OK (sin tráfico no es error)             | Error | Fallas internas sostenidas, no un caso aislado      | Logs `ERROR`, trazas `status=error`, readiness                     |
| **M9LatenciaP95Alta**      | `histogram_quantile(0.95, …bucket{business})` y volumen mínimo      | > 0.5 s  | 5m          | 10m   | OK                                       | Error | Degradación de rendimiento                          | p95 por ruta (GET /reservas sin paginación), DB p95, M7            |
| **M9DependenciaCaida**     | `min by (dependency) (m9_dependency_up) == 0`                       | = 0      | instantánea | 2m    | **Alerting** (sin chequeos = no se sabe) | Error | PostgreSQL/Redis/RabbitMQ no responde               | Ver contenedor; Redis caído → locks 503; RabbitMQ → backlog Outbox |
| **M9TelemetriaAusente**    | `absent_over_time(http_server_active_requests[10m])`                | ausencia | 10m         | 5m    | Alerting                                 | Error | No llegan datos: proceso, Alloy o credenciales      | UI Alloy :12345, `docker logs`                                     |
| **M9SchedulerSinProgreso** | `time() - max(m9_scheduler_last_success_timestamp_seconds)`         | > 120 s  | instantánea | 2m    | **Alerting**                             | Error | El cron no completa ejecuciones (Compose: cada 5 s) | Logs `reservation_scheduler_error`, `runs_total{result="error"}`   |
| **M9OutboxEnvejecido**     | `max(m9_outbox_oldest_pending_age_seconds)`                         | > 60 s   | instantánea | 5m    | Alerting (recolector caído)              | Error | Eventos sin publicar (poll 5 s)                     | RabbitMQ, `m9_outbox_failures_total`                               |
| **M9ActivandoEstancadas**  | `max(m9_reservations_stuck_activating)`                             | > 0      | instantánea | 5m    | Alerting                                 | Error | Reservas sin respuesta de M5 > 120 s                | Cola M5, Inbox, DLQ                                                |
| **M9DlqConMensajes**       | `max(m9_rabbitmq_queue_messages{queue_role="dead_letter"})`         | > 0      | instantánea | 1m    | OK                                       | Error | Mensajes agotaron reintentos                        | UI RabbitMQ :15672, traza por `traceparent` del header             |

Notas:

- En reglas data source-managed (Mimir) una serie ausente simplemente **no dispara**; por eso
  existe `M9TelemetriaAusente` y los gauges de estado no publican ceros falsos.
- Intervalo de evaluación 1m. Con métricas cada 15 s hay ≥ 4 muestras por minuto.
- Calibración sugerida: correr `k6:load` estable, tomar p95 por operación y fijar el umbral
  con margen (p. ej. 1.5× el p95 medido); documentar el valor elegido y la fecha.
