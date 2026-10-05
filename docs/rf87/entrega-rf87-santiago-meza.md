# Entrega Individual AE2: RF-8.7 — Entrega de Notificaciones

* **Estudiante:** Santiago Meza
* **Módulo:** Módulo 8 — Notificaciones, Documentos y Soporte (Grupo 6 / Grupo 14)
* **Rama de trabajo:** `ae2/santiago-meza`
* **Versión de partida:** Commit base de `origin/M8-Notifications-QR-Receipts-Support`

---

## 1. Cumplimiento de Requerimientos y Acuerdos de Integración

| # | Requerimiento / Acuerdo | Estado | Evidencia y Ubicación en el Repositorio |
| :-: | :--- | :-: | :--- |
| **1** | **Consumo de `NotificationRequested` sin alterar texto** | **COMPLETADO** | [`contracts/events/rf87-notification-requested.contract.md`](../../contracts/events/rf87-notification-requested.contract.md)<br>[`contracts/events/schemas/notification-requested.v1.schema.json`](../../contracts/events/schemas/notification-requested.v1.schema.json). Consume texto exacto generado por RF8.1. |
| **2** | **Reutilización de `messaging.inbox_events` (RF8.6) y Lease** | **COMPLETADO** | [`docs/rf87/adr/ADR-001-rf87-idempotencia-y-resiliencia.md`](./adr/ADR-001-rf87-idempotencia-y-resiliencia.md). Consumer ID `m8.delivery.notification-requested`, reclamo atómico, control de lease de 30s para evitar colisiones concurrentes y recuperación de workers caídos. ACK inmediato solo si está PROCESSED. |
| **3** | **Reutilización de DLQ y reintentos (RF8.6)** | **COMPLETADO** | Reutiliza topología `mobility.events` y `mobility.events.dlx`. Documentados 3 reintentos internos con backoff ante fallos transitorios antes de desvío terminal a DLQ vía `NACK(requeue=false)`. |
| **4** | **Device Tokens asociados a userId de M1 con JWT** | **COMPLETADO** | Endpoints `POST /devices/tokens`, `GET /devices/tokens`, `DELETE /devices/tokens/:token` protegidos con JWT de M1. El `userId` se deriva estrictamente del token. Documentado en OpenAPI [`openapi/notification-delivery.openapi.yaml`](../../openapi/notification-delivery.openapi.yaml). |
| **5** | **Preferencia M2 antes del envío** | **COMPLETADO** | Cliente desacoplado `M2PreferencesClient` con header `x-api-key: ${M2_INTERNAL_API_KEY}`. Si preferencia está en OFF, omite el PUSH (`SKIPPED_PREFERENCE_OFF`) y emite ACK. Propuesta formal de contrato documentada en ADR-002. |
| **6** | **Persistencia en esquema `notification_delivery`** | **COMPLETADO** | [`infra/postgres/init/04-notification-delivery.sh`](../../infra/postgres/init/04-notification-delivery.sh) con rol `m8_notification_delivery` y tablas `device_tokens`, `delivery_requests` y `delivery_attempts`. |
| **7** | **Sanitización de Logs (RNF-13)** | **COMPLETADO** | Logger estructurado en JSON (`src/infrastructure/logging/logger.ts`) que jamás imprime device tokens, JWT ni API keys. |
| **8** | **Integración mínima y reproducible en Compose y .env** | **COMPLETADO** | Registrado en `compose.yaml` (puerto 3107), `.env.example` con variables de M2 y delivery, y `m8-openapi.yaml`. |

---

## 2. Resultados de Pruebas Automatizadas (38 Tests en Verde)

```bash
npx tsx --test modulo-8/services/notification-delivery/tests/unit/*.test.ts modulo-8/services/notification-delivery/tests/integration/*.test.ts
```

### Matriz de cobertura:
1. **Preferencia ON en M2:** Envío PUSH exitoso.
2. **Preferencia OFF en M2:** Omisión limpia (`SKIPPED_PREFERENCE_OFF`) y ACK sin PUSH.
3. **Usuario sin device token:** Falla de negocio controlada (`FAILED_NO_DEVICE_TOKEN`) sin bucles infinitos.
4. **Token actualizado:** Envío automático dirigido al último token activo del usuario autenticado.
5. **Provider caído / lento:** 3 reintentos con backoff exponencial y desvío a DLQ.
6. **M2 caído:** Manejo de resiliencia service-to-service.
7. **Retry y recuperación:** Éxito en 3er intento tras fallos transitorios en 1 y 2.
8. **Mensaje duplicado:** Detección en Inbox con `ACK_DUPLICATE` inmediato sin redisparo.
9. **Dos consumidores concurrentes:** Concurrencia atómica con un único PUSH despachado.
10. **Recuperación de lease huérfano:** Consumidor recupera mensaje PENDING cuyo lease expiró.
11. **Mensaje inválido / DLQ:** Validador detecta esquema corrupto para desvío a DLQ.
12. **Device Tokens API (M1 JWT):** Rechazo 401 sin JWT, registro con extracción de userId, listado y desactivación.
13. **Prueba E2E Completa:** Ciclo completo `notification.requested` $\rightarrow$ M2 $\rightarrow$ Device Token $\rightarrow$ Provider $\rightarrow$ Auditoría.

**Total ejecutado:** **38 tests ejecutados, 38 exitosos, 0 fallos.**
