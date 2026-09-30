# Documentación técnica: m8-documentos

**Materia:** ISI - Paradigmas de Programación 3 (2026)
**Módulo:** M8 - Notificaciones, Documentos y Soporte
**Servicio:** comprobantes de viaje en PDF (RF-8.3 y RF-8.4)

## AE2: versión 2.0.0 (Juan Gualtieri, evolución individual)

| Documento | Contenido |
| --- | --- |
| [Arquitectura AE2](arquitectura/arquitectura-ae2.md) | Diagrama de componentes, propiedad de datos, secuencias de emisión asincrónica y de enlace temporal, observabilidad |
| [ADR-003: RabbitMQ y Redis](adr/ADR-003-backing-services-ae2.md) | Emisión por evento, reintentos y DLQ, bandeja de salida, idempotencia en dos capas, enlace temporal |
| [ADR-004: persistencia](adr/ADR-004-persistencia-ae2.md) | PostgreSQL con esquema y rol propios, PDF en la base frente a almacenamiento de objetos, `UNIQUE` como árbitro |
| [Concurrencia e idempotencia AE2](pruebas/concurrencia-idempotencia-ae2.md) | La carrera reproducida, su solución y la demostración con dos réplicas |
| [Catálogo de eventos v1](../../../contracts/events/catalogo-eventos-v1.md) | Topología de RabbitMQ, sobre del mensaje, `payment.confirmed`, `receipt.issued` y contrato interno con Receipts Delivery |
| [OpenAPI 2.0.0](../../../openapi/receipts.openapi.yaml) | Contrato de la API pública |

Puesta en marcha, pruebas y demostraciones: [README del servicio](../README.md).

## AE1: versión 1.0.0 (Grupo 14, conservada como evidencia)

Describen el estado heredado. Lo que AE2 reemplazó se indica al comienzo de cada documento.

| Documento | Contenido |
| --- | --- |
| [ADR-001](adr/ADR-001-m8-comprobantes-ae1.md) | Arquitectura base y PDFKit |
| [ADR-002](adr/ADR-002-docker-compose-testing.md) | Contenerización y pruebas con Docker Compose |
| [Componentes AE1](arquitectura/componentes-m8.md) | Diagramas de la versión 1.0.0 |
| [Manual de operación AE1](despliegue/manual-operacion-docker.md) | Operación con Docker en AE1 |
| [Pruebas y concurrencia AE1](pruebas/reporte-pruebas-concurrencia.md) | Suite de 22 pruebas y prueba de 8 solicitudes |
| [API AE1](api/contrato-y-endpoints.md) | Endpoints de la versión 1.0.0 |
