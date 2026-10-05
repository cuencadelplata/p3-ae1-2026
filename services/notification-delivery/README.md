# Microservicio de Entrega de Notificaciones (RF8.7)

**Responsable:** Santiago Meza  
**Módulo:** M8 — Notificaciones, Documentos y Soporte  
**Versión:** 1.0.0 (AE2)

---

## 1. Responsabilidad y Propósito

Este servicio implementa el requerimiento **RF-8.7 (Entrega de notificaciones)**:
- Consume solicitudes de entrega de eventos `NotificationRequested` originadas por el Transactional Outbox de RF8.1.
- Aplica deduplicación e idempotencia estricta mediante `messageId` (Inbox pattern).
- Gestiona el ciclo de vida de la entrega hacia el proveedor PUSH (sandbox o gateway real).
- Maneja políticas de reintento ante fallos temporales y desvío a DLQ ante fallos definitivos.
- Persiste las solicitudes y el historial de intentos en su propio esquema `delivery` en la base de datos `CommunicationsDB`.
- Expone endpoints HTTP para auditoría y observabilidad (`/internal/deliveries/:notificationId`).

---

## 2. Endpoints HTTP

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health/live` | Healthcheck de vitalidad (Liveness probe). |
| `GET` | `/health/ready` | Healthcheck de disponibilidad de dependencias (Readiness probe). |
| `GET` | `/health` | Alias estandarizado hacia `/health/ready`. |
| `GET` | `/internal/deliveries/:notificationId` | Consulta y auditoría del estado e historial de intentos de una entrega. |
| `POST` | `/internal/deliveries/simulate` | Endpoint para simulación y pruebas de despacho de `NotificationRequested`. |

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
- **`sandbox-push-provider.test.ts`**: Comportamiento del sandbox en modos normal, fallo transitorio y fallo permanente.
- **`notification-delivery.service.test.ts`**: Idempotencia con `messageId` (detección de duplicados sin re-envío), reintentos con backoff ante caídas temporales y desvío ante fallos terminales.
- **`delivery-api.test.ts`**: Endpoints de salud, simulación HTTP y auditoría por `notificationId`.
