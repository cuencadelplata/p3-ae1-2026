# ADR-001: Arquitectura y Estrategia de Implementación de Comprobantes PDF (AE1)

* **Estado:** Aceptado
* **Fecha:** 2026-09-01
* **Autores:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago (Grupo 14)
* **Requerimientos:** RF-8.3, RF-8.4, RNF-01, RNF-03, RNF-04, RNF-05, RNF-08, RNF-09, RNF-11, RNF-17

---

## Contexto

El Módulo 8 (Notificaciones, Documentos y Soporte) debe proveer en la entrega AE1 la capacidad de generar comprobantes de viaje en PDF ante la finalización de un viaje y permitir su consulta, descarga y reenvío. El sistema debe operar en una arquitectura modular de servicios distribuidos, con contratos OpenAPI formales, ejecución contenerizada en Docker, tolerancia a solicitudes concurrentes e idempotencia estricta.

## Decisiones Adoptadas

### 1. Plataforma y Lenguaje (RNF-01)
* Se adopta **Node.js 22 LTS con TypeScript**.
* **Justificación:** Tipado estático riguroso para los modelos de datos compartidos, rendimiento asíncrono no bloqueante y madurez de librerías para generación documental y APIs REST con Express.

### 2. Motor de Generación de PDF (RF-8.3)
* Se selecciona **PDFKit**.
* **Justificación:** Genera PDFs vectoriales puros directamente en memoria sin requerir dependencias pesadas de navegadores headless (como Chromium/Puppeteer), reduciendo el consumo de RAM en contenedores y acelerando los tiempos de respuesta.

### 3. Persistencia de Datos en AE1 (RNF-04)
* Se utiliza persistencia transitoria en sistema de archivos local (`storage/receipts/`) dividida en:
  - `metadata/`: Archivos JSON con metadatos y trazabilidad de entregas.
  - `pdf/`: Archivos binarios `.pdf`.
* **Justificación:** Simplifica el despliegue en AE1 sin dependencias externas pesadas, asegurando el aislamiento de datos y preparando la transición transparente hacia Base de Datos SQL + Object Storage en AE2.

### 4. Idempotencia y Concurrencia (RNF-08 / RNF-09)
* Se implementa un candado en memoria por identificador de viaje (`withLock(tripId)`) junto con escrituras atómicas en disco (flag `wx` y rename de archivo temporal).
* **Justificación:** Si dos llamadas concurrentes intentan emitir el comprobante para el mismo `tripId`, la primera emite el documento (`201 Created`) y la segunda devuelve el documento existente (`200 OK`), evitando duplicación o corrupción de archivos.

### 5. Contrato OpenAPI y Swagger UI (RNF-05)
* Se define el contrato formal en `src/openapi/openapi.yaml` (OpenAPI 3.0) y se expone la interfaz Swagger UI en `http://localhost:3008/api/v1/docs`.
* **Justificación:** Permite la interoperabilidad desacoplada entre módulos y brinda una consola interactiva para demostración y evaluación.

### 6. Estrategia de Testing (RNF-17)
* Se utiliza el ejecutor de pruebas nativo `node:test` y `node:assert/strict` de Node.js ejecutado vía `tsx --test`.
* **Justificación:** No requiere dependencias adicionales como Jest/Mocha y cubre tanto las validaciones unitarias como la integración HTTP de punta a punta.

## Consecuencias

* **Positivas:**
  - Microservicio 100% autónomo, ligero y portable.
  - Generación del PDF en 3,3 ms de mediana y 6,3 ms en el percentil 95 (30 muestras).
  - 22 pruebas automatizadas entre unitarias e integración HTTP, que corren en alrededor de un segundo.
  - Documentación interactiva disponible sin herramientas externas.
* **A considerar para AE2:**
  - Reemplazar el almacenamiento en disco por PostgreSQL (`CommunicationsDB`) y S3/MinIO.
  - Reemplazar la simulación de reenvío en memoria por publicación de eventos en RabbitMQ (`NotificationRequested`).
