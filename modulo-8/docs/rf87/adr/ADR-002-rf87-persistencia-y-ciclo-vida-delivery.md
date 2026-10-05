# ADR-002 (RF8.7): Persistencia en notification_delivery, Device Tokens y Preferencias M2

* **Estado:** Aceptado / Congelado (AE2 - Actualizado con acuerdos de integración)
* **Fecha:** 2026-10-05
* **Autor:** Santiago Meza (RF8.7 — Entrega de Notificaciones)
* **Requerimientos asociados:** RF-8.7, RNF-04 (Propiedad de datos), RNF-11 (Configuración externa), RNF-13 (Observabilidad)

---

## 1. Contexto y Problema

Para completar el ciclo de entrega de notificaciones en AE2:
1. RF8.7 es el propietario del almacenamiento y gestión del ciclo de vida de los **Device Tokens** (FCM/APNs) vinculados al `userId` canónico de **M1**.
2. Antes de realizar el envío PUSH, se debe consultar a **M2** la preferencia del cliente mediante una autenticación interna con API key (`x-api-key: ${M2_INTERNAL_API_KEY}`).
3. La persistencia de solicitudes, tokens e intentos debe residir en un esquema exclusivo en `CommunicationsDB`: `notification_delivery`.

---

## 2. Decisiones de Diseño

### Decisión 1: Esquema `notification_delivery` y Rol Dedicado (RNF-04)
El script [`modulo-8/infra/postgres/init/04-notification-delivery.sh`](file:///d:/Projects/p3-ae1-2026/modulo-8/infra/postgres/init/04-notification-delivery.sh) configura:
- **Rol:** `m8_notification_delivery`.
- **Esquema:** `notification_delivery`.
- **Tablas:**
  - `device_tokens`: `(token_id, user_id, token, platform, is_active, created_at, updated_at)`.
  - `delivery_requests`: `(delivery_id, notification_id, message_id, trip_id, user_id, status, title, message, device_token, skip_reason)`.
  - `delivery_attempts`: `(attempt_id, delivery_id, attempt_number, status, latency_ms, provider_response, error_message, attempted_at)`.

### Decisión 2: API de Device Tokens Protegida con JWT de M1
- Los endpoints REST (`POST /devices/tokens`, `GET /devices/tokens`, `DELETE /devices/tokens/:token`) exigen header `Authorization: Bearer <jwt>`.
- El `userId` **nunca se toma de campos del body**; se extrae estrictamente del claim `sub` / `userId` del JWT de M1.
- Si no hay token o es inválido, se rechaza inmediatamente con `401 Unauthorized`.
- Especificación OpenAPI documentada en [`modulo-8/openapi/notification-delivery.openapi.yaml`](file:///d:/Projects/p3-ae1-2026/modulo-8/openapi/notification-delivery.openapi.yaml).

### Decisión 3: Integración Desacoplada con M2 (Preferencias)
- Autenticación: header `x-api-key: ${M2_INTERNAL_API_KEY}` configurado por variable de entorno externa (nunca hardcodeado).
- **Contrato Propuesto a M2:**
  - **Endpoint:** `GET /internal/preferences/{userId}`
  - **Headers:** `x-api-key: <secret>`, `x-correlation-id: <tripId>`
  - **Respuesta esperada:**
    ```json
    {
      "userId": "usr-0091",
      "notificationsEnabled": true,
      "pushEnabled": true
    }
    ```
- **Comportamiento si preferencia es OFF:** Se omite el envío PUSH, se registra en base de datos como `SKIPPED_PREFERENCE_OFF` con motivo `M2_PREFERENCE_DISABLED`, se audita y se emite `ACK` a RabbitMQ.

### Decisión 4: Sanitización Estricta de Logs (RNF-13)
- En cumplimiento de las políticas de seguridad: **nunca se imprimen device tokens, JWT ni API keys** en los logs.
- Todos los logs se generan en JSON estructurado conteniendo `messageId`, `notificationId`, `userId`, `tripId`, `attempt`, `latencyMs` y `result`.
