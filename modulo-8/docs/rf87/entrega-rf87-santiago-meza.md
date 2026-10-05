# Entrega Individual AE2: RF-8.7 — Entrega de Notificaciones

* **Estudiante:** Santiago Meza
* **Módulo:** Módulo 8 — Notificaciones, Documentos y Soporte (Grupo 6 / Grupo 14)
* **Rama de trabajo:** `ae2/santiago-meza`
* **Versión de partida:** Commit base de `origin/M8-Notifications-QR-Receipts-Support`

---

## 1. Cumplimiento de los Puntos Asignados

| # | Consigna Asignada | Estado | Evidencia y Ubicación en el Repositorio |
| :-: | :--- | :-: | :--- |
| **1** | **Definir y congelar el schema exacto de `NotificationRequested.data`** | **COMPLETADO** | [`contracts/events/rf87-notification-requested.contract.md`](../../contracts/events/rf87-notification-requested.contract.md)<br>[`contracts/events/schemas/notification-requested.v1.schema.json`](../../contracts/events/schemas/notification-requested.v1.schema.json) |
| **2** | **Especificar nombres, tipos y obligatoriedad de cada campo** | **COMPLETADO** | Sección 4 del contrato formal y validador de tipos en [`services/notification-delivery/src/domain/notification-requested.contract.ts`](../../services/notification-delivery/src/domain/notification-requested.contract.ts). |
| **3** | **Confirmar qué información necesita RF8.7 para efectuar delivery real** | **COMPLETADO** | Sección 5 del contrato: Destino físico (`targetDestination` / fallback token), cuerpo (`message`), título inferido (`title`), prioridad (`priority`) y metadatos de correlación (`tripId`, `notificationId`). |
| **4** | **Confirmar idempotencia usando `messageId`** | **COMPLETADO** | [`docs/rf87/adr/ADR-001-rf87-idempotencia-y-resiliencia.md`](./adr/ADR-001-rf87-idempotencia-y-resiliencia.md). Implementado con Inbox Pattern (`UNIQUE message_id`) y validado con tests unitarios y de integración (mensaje duplicado se confirma con ACK sin reenviar PUSH). |
| **5** | **Definir cómo registra o comunica éxito/fallo del delivery** | **COMPLETADO** | [`docs/rf87/adr/ADR-002-rf87-persistencia-y-ciclo-vida-delivery.md`](./adr/ADR-002-rf87-persistencia-y-ciclo-vida-delivery.md), esquema PostgreSQL `delivery`, rol `m8_delivery` en [`infra/postgres/init/02-notification-delivery.sh`](../../infra/postgres/init/02-notification-delivery.sh), y endpoint interno `GET /internal/deliveries/:notificationId`. |
| **6** | **Pasar branch + commits o archivos de contrato cuando quede estable** | **COMPLETADO** | Rama `ae2/santiago-meza`, contrato formal en [`rf87-notification-requested.contract.md`](../../contracts/events/rf87-notification-requested.contract.md) e historial de commits por etapa detallado en este documento. |

---

## 2. Historial de Commits por Etapas (Trazabilidad Individual)

Cada etapa del desarrollo fue implementada de forma aislada sin modificar archivos de otros requerimientos ni integrantes:

1. **Etapa 1 — Contrato formal y JSON Schema:**  
   `docs(rf8.7): congelar contrato y schema formal de NotificationRequested (Etapa 1)`  
   *Artefactos:* `rf87-notification-requested.contract.md` y `notification-requested.v1.schema.json`.
2. **Etapa 2 — Idempotencia y Resiliencia:**  
   `docs(rf8.7): documentar estrategia de idempotencia con messageId y resiliencia (Etapa 2)`  
   *Artefactos:* `ADR-001-rf87-idempotencia-y-resiliencia.md`.
3. **Etapa 3 — Persistencia, Rol PostgreSQL y Ciclo de Vida:**  
   `feat(rf8.7): definir esquema de persistencia, rol postgres y ciclo de vida de delivery (Etapa 3)`  
   *Artefactos:* `ADR-002-rf87-persistencia-y-ciclo-vida-delivery.md` y `02-notification-delivery.sh`.
4. **Etapa 4 — Servicio de Entrega, Sandbox Provider y Suite de Pruebas:**  
   `feat(rf8.7): implementar servicio de entrega de notificaciones con sandbox, inbox y pruebas (Etapa 4)`  
   *Artefactos:* Código fuente en `services/notification-delivery/` y 21 pruebas automatizadas pasando.
5. **Etapa 5 — Documentación de Cierre y Trazabilidad:**  
   `docs(rf8.7): documentar informe de entrega y cierre de integracion (Etapa 5)`  
   *Artefactos:* Este documento de informe final.

---

## 3. Verificación y Resultados de Pruebas

Para reproducir la verificación completa de RF8.7:

```bash
npx tsx --test modulo-8/services/notification-delivery/tests/unit/*.test.ts modulo-8/services/notification-delivery/tests/integration/*.test.ts
```

### Resumen de ejecución:
- **Pruebas de validación de contrato:** 5 pass (detección de tipos inválidos, campos obligatorios y formato ISO 8601).
- **Pruebas de Sandbox PUSH:** 4 pass (modos normal, latencia, fallo transitorio y fallo permanente).
- **Pruebas de servicio:** 5 pass (entrega exitosa, deduplicación e idempotencia por `messageId`, reintentos exponenciales y desvío a estado FAILED).
- **Pruebas de API HTTP:** 6 pass (liveness, readiness con health checks estandarizados, simulación HTTP y auditoría por `notificationId`).
- **Total:** **21 tests ejecutados, 21 exitosos, 0 fallos.**
