# Consigna AE2: alcance individual y evidencias

Consigna oficial: [ISI-Paradigmas3-2026-AE2-v01.pdf](../../../../docs/references/ISI-Paradigmas3-2026-AE2-v01.pdf)
(actividad ISI17PL324V26AE2V26, individual y asincrónica, Escenario 2: movilidad tipo Uber).

Este documento reúne en un solo lugar lo que la consigna pide documentar antes de
implementar y relaciona cada criterio de la rúbrica con la evidencia del repositorio.

## 1. Alcance individual comprometido

| Punto que pide la consigna | Respuesta |
| --- | --- |
| Escenario | Escenario 2: Aplicación de Movilidad tipo Uber. |
| Versión de AE1 de partida | Commit [`d041e61`](https://github.com/cuencadelplata/p3-ae1-2026/commit/d041e61) de la rama `M8-Notifications-QR-Receipts-Support` (unificación del módulo, `m8-documentos` 1.0.0), confirmado por la cátedra. |
| Módulo | M8: Notificaciones, Documentos y Soporte; servicio `m8-documentos` (comprobantes). |
| Requerimientos funcionales | **RF-8.3** Comprobante PDF (evoluciona). Se integra con RF-8.4 (reenvío, mediante una referencia de descarga temporal) y aplica RF-8.6 (consumo asíncrono) en su propio flujo. |
| Requerimientos no funcionales | RNF-04 propiedad de datos, RNF-05 contratos y errores uniformes, RNF-06 Redis con TTL, RNF-07 RabbitMQ, RNF-08 idempotencia, RNF-09 concurrencia, RNF-11 configuración externa, RNF-13 logs con correlación, RNF-16 health checks, RNF-17 pruebas, RNF-22 versionado. Anticipados de AE4: RNF-14 (timeout y circuit breaker) y parte de RNF-23 (sin datos personales en logs ni en enlaces). |
| Dependencias con otros componentes | M7 se integra por REST (2026-10-04): antes de emitir, el servicio consulta `GET /metodo-pago/{viajeId}` y toma de M7 el estado, el medio de pago y el importe cobrado. M7 no publica `payment.confirmed`; esa entrada asíncrona se conserva con productor simulado (catálogo de eventos, sección 5.1). Receipts Delivery (RF-8.4) consume `GET /internal/receipts/{tripId}/delivery-reference`. Los consumidores de `receipt.issued` lo reciben por el exchange `mobility.events`. Infraestructura: PostgreSQL, RabbitMQ, Redis, el autorizador fiscal simulado y M7 simulado (`m7-payments-sandbox`). |
| Estado inicial heredado | Emisión solo por `POST /receipts`; comprobante en JSON y PDF en un volumen; unicidad con un candado en memoria (una sola instancia); PDF publicado en una URL estática predecible; logs de texto; un único `/health`. Detalle en [ADR-001](adr/ADR-001-m8-comprobantes-ae1.md) y [componentes AE1](arquitectura/componentes-m8.md). |
| Alcance comprometido | Emisión asincrónica al confirmarse el pago, con reintentos y DLQ; persistencia en PostgreSQL sin duplicados con varias réplicas; aviso `receipt.issued` mediante bandeja de salida; descarga por enlace temporal en Redis; logs con `correlationId` y salud por dependencia; autorización ante un servicio externo simulado con timeout y circuit breaker. |
| Ajuste por integración (2.2.0 y 2.3.0) | M7 cambió a REST durante la integración del módulo. Acordado con Invaldi sin tocar el núcleo: consulta del pago a M7 antes de emitir (autorizado emite, pendiente se reintenta, rechazado es terminal, M7 caído responde `503`), medio de pago `TRANSFERENCIA`, importe y moneda tomados de M7, y M7 simulado para pruebas reproducibles. Registrado en la actualización de la decisión 1 de [ADR-003](adr/ADR-003-backing-services-ae2.md). |
| Fuera de esta entrega | Entrega real por email, SMS o push (RF-8.4 y RF-8.7, a cargo de otros integrantes; el reenvío sigue simulado). Autenticación y autorización de los endpoints (corresponden a M1). QR (RF-8.2), notificaciones (RF-8.1) y soporte (RF-8.5). Almacenamiento de objetos para el PDF, alta disponibilidad con balanceador, CI/CD con registry y publicación (AE4). Autorizador fiscal real. |

## 2. Criterios de la rúbrica y evidencia

| # | Criterio | Evidencia |
| ---: | --- | --- |
| 1 | Trazabilidad AE1 → AE2 | Sección 1; tabla "Qué cambió respecto de AE1" del [README](../README.md); documentos de AE1 conservados en el [índice](README.md). |
| 2 | RF comprometidos | Flujo pedido → pago verificado en M7 → comprobante → `receipt.issued` y descarga temporal; E2E en `modulo-8/tests/e2e/receipts-ae2.e2e.test.mjs` (incluye pago pendiente que se emite al autorizarse y pago rechazado que va a la DLQ). |
| 3 | Evolución arquitectónica | [Arquitectura AE2](arquitectura/arquitectura-ae2.md): componentes, límites con M7 (consulta REST del pago) y Receipts Delivery. |
| 4 | APIs y contratos | [OpenAPI](../../../openapi/receipts.openapi.yaml), formato de error único y contrato interno en la sección 6 del [catálogo de eventos](../../../contracts/events/catalogo-eventos-v1.md). |
| 5 | Mensajería | [Catálogo de eventos v1](../../../contracts/events/catalogo-eventos-v1.md) y [ADR-003](adr/ADR-003-backing-services-ae2.md): productor, consumidor, sobre, reintentos y DLQ. |
| 6 | Redis y estado efímero | Decisión 5 de [ADR-003](adr/ADR-003-backing-services-ae2.md); `tests/integration/download-link.test.ts` (TTL y vencimiento con `410`). |
| 7 | Concurrencia e idempotencia | [Concurrencia e idempotencia AE2](pruebas/concurrencia-idempotencia-ae2.md): la carrera sin `UNIQUE`, su solución y dos réplicas reales. |
| 8 | Persistencia y propiedad de datos | [ADR-004](adr/ADR-004-persistencia-ae2.md): esquema `receipts` y rol propios, sin lecturas de datos ajenos. |
| 9 | Integraciones y artefactos | PDF, autorizador fiscal simulado (`modulo-8/infra/fiscal-sandbox`) y API de pagos de M7 simulada con su mismo contrato (`modulo-8/infra/m7-payments-sandbox`); [ADR-005](adr/ADR-005-resiliencia-ae2.md). |
| 10 | Testing y reproducibilidad | Sección "Desarrollo y pruebas" del [README](../README.md); `pnpm run test:e2e` y `pnpm run test:resiliencia`; pipeline `.github/workflows/m8-ci.yml`. |
| 11 | Trazabilidad individual | Rama `ae2/juan-gualtieri` hasta la 2.1.0 y, desde la unificación del módulo, `integration/m8-ae2-unified`; issues #6 a #18; tags `ae2-juan-gualtieri-v2.0.0`, `ae2-juan-gualtieri-v2.1.0` y `ae2-juan-gualtieri-v2.3.0`. |
| 12 | Fundamentación | Alternativas comparadas en [ADR-003](adr/ADR-003-backing-services-ae2.md), [ADR-004](adr/ADR-004-persistencia-ae2.md) y [ADR-005](adr/ADR-005-resiliencia-ae2.md); Portafolio y bitácora individuales. |

## 3. Evidencias mínimas de la entrega

| Evidencia | Ubicación |
| --- | --- |
| Versión base de AE1 | Commit `d041e61` (sección 1) |
| Repositorio y rama | https://github.com/cuencadelplata/p3-ae1-2026. Rama individual `ae2/juan-gualtieri` (hasta la 2.1.0) y rama de integración del módulo `integration/m8-ae2-unified` (2.2.0 y 2.3.0). Por indicación del profesor, M8 entrega un único zip consolidado del módulo |
| RF seleccionados | Sección 1 |
| Issues | #6 a #18 y [tablero](https://github.com/users/JuaniGualtieri/projects/1) |
| Historial de commits | `git log --author=JuaniGualtieri d041e61..origin/integration/m8-ae2-unified` |
| Código y pruebas | `modulo-8/services/receipts/src` y `tests`; `modulo-8/tests/e2e` |
| Contratos de API y eventos | OpenAPI y catálogo de eventos (sección 2) |
| Redis y RabbitMQ | ADR-003 y catálogo de eventos, secciones 2 y 7 |
| Decisiones de arquitectura y persistencia | ADR-003, ADR-004, ADR-005 y arquitectura AE2 |
| Instrucciones de ejecución y README | [README del servicio](../README.md) |
| Portafolio Digital y reflexión individual | Fuera del repositorio, a cargo del estudiante |
