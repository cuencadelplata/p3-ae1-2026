# Índice de Documentación Técnica - Módulo 8 (Comprobantes PDF)

**Materia:** ISI - Paradigmas de Programación 3 (2026)  
**Módulo:** M8 - Notificaciones, Documentos y Soporte  
**Grupo 14:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago  
**Alcance:** RF-8.3 (Comprobante PDF) y RF-8.4 (Reenvío de Comprobante) — Instancia AE1  

---

Bienvenido al centro de documentación técnica del microservicio `m8-documentos`. A continuación se detallan los documentos de ingeniería, arquitectura, despliegue y pruebas del proyecto:

---

## 🗺️ Mapa de Documentación

### 1. Arquitectura del Sistema
* 📄 **[Diagramas de Componentes y Secuencia (`docs/arquitectura/componentes-m8.md`)](./arquitectura/componentes-m8.md)**  
  Visualización en Mermaid de la interacción entre capas (Controladores, Servicios, Repositorios), flujo de emisión de comprobantes, aislamiento de datos (RNF-04) y usabilidad.

### 2. Registro de Decisiones de Arquitectura (ADR)
* 📄 **[ADR-001: Arquitectura Base y Generación PDF con PDFKit (`docs/adr/ADR-001-m8-comprobantes-ae1.md`)](./adr/ADR-001-m8-comprobantes-ae1.md)**  
  Justificación de la elección de Node.js 22 LTS, TypeScript 7, motor PDFKit en memoria, persistencia transitoria en disco y estrategia de idempotencia.
* 📄 **[ADR-002: Contenerización con Docker Compose e Imagen Unificada (`docs/adr/ADR-002-docker-compose-testing.md`)](./adr/ADR-002-docker-compose-testing.md)**  
  Justificación de la adopción de Docker Compose, eliminación de dependencias en el host, imagen única para producción y testing, y automatización de pruebas.

### 3. Despliegue e Infraestructura
* 📄 **[Manual de Operación y Despliegue con Docker (`docs/despliegue/manual-operacion-docker.md`)](./despliegue/manual-operacion-docker.md)**  
  Guía práctica para iniciar (`docker compose up -d`), consultar logs (`docker compose logs -f`), detener (`docker compose down`), persistencia de volúmenes (`m8-storage`) y resolución de problemas.

### 4. Calidad, Pruebas y Concurrencia
* 📄 **[Reporte de Estrategia de Pruebas y Concurrencia (`docs/pruebas/reporte-pruebas-concurrencia.md`)](./pruebas/reporte-pruebas-concurrencia.md)**  
  Detalle de la suite de 22 tests unitarios e integración HTTP, validaciones de tarifas y vehículos, y evidencia de la prueba de estrés de 8 solicitudes concurrentes con idempotencia demostrada.

### 5. Contrato de API y Consola Interactiva
* 📄 **[Especificación de la API REST y Contrato OpenAPI (`docs/api/contrato-y-endpoints.md`)](./api/contrato-y-endpoints.md)**  
  Catálogo completo de endpoints (`/receipts`, `/receipts/:tripId/pdf`, `/resend`, `/health`), esquemas de solicitud/respuesta, formato uniforme de errores (RNF-05) y acceso a Scalar API Reference (`/docs`).

---

## 🚀 Resumen Rápido de Puesta en Marcha

```bash
# 1. Posicionarse en la carpeta
cd m8-documentos

# 2. Levantar el microservicio en Docker
docker compose up -d

# 3. Correr la suite de pruebas completa
docker compose run test

# 4. Acceder a la consola interactiva en el navegador
# http://localhost:3008/docs
```
