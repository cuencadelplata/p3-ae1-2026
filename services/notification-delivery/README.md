# Microservicio de Entrega de Notificaciones (RF8.7)

**Responsable:** Santiago Meza<br />
**Módulo:** M8 — Notificaciones, Documentos y Soporte<br />
**Versión:** 1.0.0 (AE2)

---

## 1. Responsabilidad y Propósito

Este servicio implementa el requerimiento **RF-8.7 (Entrega de notificaciones)**:
- Consume solicitudes de entrega de eventos `NotificationRequested` originadas por el Transactional Outbox de RF8.1.
- Aplica deduplicación e idempotencia estricta mediante `messageId` (Inbox pattern).
- Gestiona el ciclo de vida de la entrega hacia el proveedor PUSH (sandbox o gateway real).
- Maneja políticas de reintento ante fallos temporales y desvío a DLQ ante fallos definitivos.
- Persiste las solicitudes y el historial de intentos en su propio esquema `notification_delivery` en la base de datos `CommunicationsDB`.
- Expone endpoints HTTP para auditoría y observabilidad (`/internal/deliveries/:notificationId`), protegidos para el destinatario o un operador y sin exponer el device token.

---

## 2. Endpoints HTTP

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health/live` | Healthcheck de vitalidad (Liveness probe). |
| `GET` | `/health/ready` | Healthcheck de disponibilidad de dependencias (Readiness probe). |
| `GET` | `/health` | Alias estandarizado hacia `/health/ready`. |
| `GET` | `/internal/deliveries/:notificationId` | Consulta autenticada y autorizada del estado e historial de intentos de una entrega. |
| `POST` | `/internal/deliveries/simulate` | Endpoint exclusivo de desarrollo y pruebas; está deshabilitado en producción. |

---

## 3. Ejecución de Pruebas

Para ejecutar la suite completa de pruebas unitarias y de integración (21 tests automatizados):

```bash
pnpm test
# O directamente con node/tsx:
npx tsx --test tests/unit/*.test.ts tests/integration/*.test.ts
```

### Cobertura de pruebas:
- **`contract-validation.test.ts`**: Validación de envelope, obligatoriedad de campos, tipos y formato de fecha.
- **`m1-auth.middleware.test.ts`**: Verificación criptográfica HMAC-SHA256, expiración exp, roles canónicos M1 y comportamiento fail-closed.
- **`sandbox-push-provider.test.ts`**: Comportamiento del sandbox en modos normal, fallo transitorio y fallo permanente.
- **`notification-delivery.service.test.ts`**: Idempotencia con `messageId` (detección de duplicados sin re-envío), reintentos con backoff ante caídas temporales y desvío ante fallos terminales.
- **`delivery-api.test.ts`**: Endpoints de salud, simulación HTTP y auditoría por `notificationId`.
- **`device-tokens-api.test.ts`**: Gestión de tokens con autenticación JWT de M1.
- **`rabbitmq-consumer.integration.test.ts`**: Consumo de RabbitMQ reutilizando infraestructura de RF8.6 y PostgresTechnicalInbox.
- **`delivery-e2e.test.ts`**: Flujo E2E desde solicitud hasta entrega PUSH simulada.

---

## 4. Integración de Autenticación con M1 (Estado y Seguridad)

- **Contrato canónico confirmado:** El identificador de usuario `userId` se extrae estrictamente del JWT y es de tipo numérico entero positivo ($\ge 1$). Los roles permitidos son exclusivamente los canónicos de M1: `CLIENTE`, `CONDUCTOR` y `OPERADOR`. No se inventan roles por defecto cuando el campo está ausente ni se toleran roles no reconocidos.
- **Expiración (`exp`):** Cuando el claim `exp` está presente en el token, se valida numéricamente contra el tiempo actual en segundos; los tokens vencidos son rechazados inmediatamente. Si se requiere `exp` de forma mandatoria, puede activarse mediante la variable de entorno `M1_JWT_REQUIRE_EXP=true`.
- **Mecanismo criptográfico (Integración pendiente):** La confirmación del mecanismo definitivo de intercambio criptográfico (secreto compartido `M1_JWT_SECRET` vs. par de claves asimétricas / JWKS) permanece pendiente de definición por el equipo de M1. No se inventa ningún flujo alternativo OAuth2 ni M2M.
- **Política Fail-Closed:** En entorno de producción (`NODE_ENV=production`), ante la ausencia de `M1_JWT_SECRET` o ante firmas/tokens inválidos, el servicio falla cerrado rechazando la solicitud con `401 Unauthorized`. Los tokens especiales de prueba (`test-token-*`) están terminantemente inhabilitados fuera de entornos de test.
