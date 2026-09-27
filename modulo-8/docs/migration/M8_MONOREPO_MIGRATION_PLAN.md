# M8 Monorepo Migration Plan

## 1. Baseline

Branch: `M8-Notifications-QR-Receipts-Support`

Baseline histórico consolidado: `6047fdf38a16318ca11ba86332d627aa11229167`.

Historias preservadas:

- `M8-Notificaciones-QR`
- `M8-Comprobantes`
- `M8-Soporte-RabbitMQ`

Todas son ancestros del baseline integrado.

## 2. Objetivo

El objetivo futuro es un monorepo M8 con siete servicios independientes:

- `notifications-processing`
- `notifications-delivery`
- `qr`
- `receipts-generation`
- `receipts-delivery`
- `support`
- `event-consumer`

Cada servicio tendrá ciclo de vida, proceso y despliegue independientes.

## 3. Principios de migración

- Preservar la historia Git.
- Preferir `git mv` cuando corresponda.
- Separar movimientos (`MOVE`) de refactors (`REFACTOR`).
- No mezclar movimientos con cambios funcionales.
- No mezclar movimientos con la migración npm a pnpm.
- No mezclar movimientos con Node 22 a Node 24.
- No consolidar Docker ni OpenAPI durante la relocalización.
- Cada servicio será propietario exclusivamente de sus datos.
- La comunicación entre servicios será mediante REST o RabbitMQ.
- Ningún servicio leerá tablas de otro.
- La branch integrada permanecerá local hasta la validación final.

## 4. Orden aprobado de extracción

1. QR
2. Notifications Processing
3. Notifications Delivery
4. Receipts Generation
5. Receipts Delivery
6. Support
7. Event Consumer

## 5. Límite Notifications

Notifications Processing será propietario de validación, construcción de la notificación, persistencia futura, estado lógico y outbox futura.

Notifications Delivery será propietario del proveedor PUSH, intentos, resultados y retry del proveedor.

Los dos servicios no compartirán base de datos.

## 6. Límite QR

QR será propietario de generación, validación, single use y estado temporal futuro en Redis.

M6 continúa siendo dueño del estado del viaje.

## 7. Límite Receipts

Receipts Generation será propietario de emisión, Receipt, metadata, idempotencia, PDF, storage, consulta y descarga.

Receipts Delivery será propietario de reenvío, DeliveryRequest, DeliveryAttempt, canal, proveedor y resultados.

Receipts Delivery no accederá directamente a la base de datos ni al storage de Receipts Generation. El contrato interno futuro contemplado es conceptualmente:

`GET /internal/receipts/{receiptId}/delivery-reference`

Puede entregar una referencia temporal/firmada o un stream controlado. No forma parte de la OpenAPI pública y no está implementado todavía.

## 8. Límite Support / Event Consumer

Support será propietario de tickets, ciclo de atención y API de soporte.

Event Consumer será propietario del consumo RabbitMQ externo, validación, idempotencia/inbox futura, ACK/NACK, retry/DLQ futuro y traducción a comandos internos.

Event Consumer no contendrá lógica de QR, PDF, tickets ni PUSH.

## 9. Infraestructura futura

**Planeado; no implementado aún.**

- Redis inicialmente para QR.
- PostgreSQL con ownership separado por servicio.
- RabbitMQ para eventos y comandos asíncronos.
- API entry técnica.
- Una OpenAPI pública M8.
- Contratos de eventos separados.

## 10. Package manager y Node

El objetivo futuro es pnpm `10.33.0` y Node `24`, ambos pendientes de validación runtime.

Durante la migración inicial se mantendrán las configuraciones históricas hasta gates específicos.

## 11. Archivos históricos temporales

Se preservarán inicialmente:

- README actual.
- OpenAPI históricas.
- Dockerfiles históricos.
- Compose históricos.
- `package-lock` existentes.
- `pnpm-lock` existentes.
- Mocks actuales.
- Configuración de tests y CI.

Solo podrán retirarse después de validar sus reemplazos.

## 12. Estrategia Git

- Los tres historiales se integraron mediante `merge --no-ff`.
- No se utilizó squash, rebase ni cherry-pick para reconstruir las historias.
- Los futuros movimientos y refactors usarán commits separados.
- Las branches históricas no se eliminarán durante la migración.

## 13. Próximo paso

La siguiente etapa será la extracción controlada de QR, en gates separados:

A. Inspección y preparación.

B. Movimiento puro.

C. Adaptación mínima.

D. Validación.

Este documento no implementa QR ni crea aplicaciones ejecutables.
