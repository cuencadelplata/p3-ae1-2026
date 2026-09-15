# Reporte de Estrategia de Pruebas, Concurrencia e Idempotencia (AE1)

**Materia:** ISI - Paradigmas de Programación 3 (2026)  
**Módulo:** M8 - Notificaciones, Documentos y Soporte (Comprobantes PDF)  
**Grupo 14:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago  
**Requerimientos Validados:** RF-8.3, RF-8.4, RNF-08, RNF-09, RNF-17  

---

## 1. Visión General de la Estrategia de Testing

Para la entrega AE1, se implementó una estrategia de pruebas multinivel sin dependencias pesadas de frameworks externos, aprovechando el ejecutor nativo de pruebas de Node.js (`node:test`) y assertions estrictos (`node:assert/strict`), todo orquestado y ejecutable mediante Docker Compose.

```
                         [ Suite de Testing (AE1) ]
                                     |
         +---------------------------+---------------------------+
         |                                                       |
 [ Tests Automatizados (22) ]                         [ Prueba de Concurrencia ]
         |                                                       |
  +------+------+                                         8 Solicitudes HTTP
  |             |                                            Simultáneas
Unitarios   Integración                                      (Promise.all)
 (Validación    HTTP                                              |
  y Lógica)  (Endpoints)                                  1x 201 Created
                                                          7x 200 OK (Idempotente)
```

---

## 2. Suite de Pruebas Automatizadas (22 Tests)

La suite se ejecuta dentro del contenedor mediante:
```bash
docker compose run test npm test
```

### 2.1. Pruebas Unitarias (`tests/unit/`)
* **Validación de esquema y tipos:**
  - Validación del formato de `tripId` (caracteres alfanuméricos, guiones, longitud máxima de 64 caracteres).
  - Tipos de vehículos permitidos estrictamente (`AUTO` y `MOTO`).
  - Métodos de pago permitidos (`EFECTIVO`, `TARJETA`, `BILLETERA`) y estados válidos (`APROBADO`, `PENDIENTE`, `RECHAZADO`).
  - Validación de coherencia aritmética en el desglose de tarifa:
    $$\text{Total} = \text{baseFare} + \text{distanceAmount} + \text{timeAmount} + \text{surcharges} - \text{discounts}$$
* **Lógica del Servicio de Comprobantes:**
  - Generación determinista del identificador de comprobante (`rec-YYYYMMDD-hash`).
  - Construcción de URLs públicas absolutas basadas en `PUBLIC_BASE_URL`.
  - Simulación de reenvío multicanal (`EMAIL`, `SMS`, `PUSH`) con registro de entrega en la trazabilidad.

### 2.2. Pruebas de Integración HTTP de Punta a Punta (`tests/integration/`)
Inician un servidor HTTP efímero en memoria y ejecutan solicitudes reales verificando contratos y códigos de estado:
* **`GET /health`:** Responde `200 OK` con estado del almacenamiento y versión del servicio.
* **`POST /api/v1/receipts` (Emisión):** Responde `201 Created` ante un viaje nuevo y genera los metadatos y el binario PDF en disco.
* **`GET /api/v1/receipts/:tripId` (Consulta de metadatos):** Responde `200 OK` con el historial de emisiones y enlaces de descarga.
* **`GET /api/v1/receipts/:tripId/pdf` (Descarga):** Responde `200 OK` con cabeceras `Content-Type: application/pdf` y `Content-Disposition: attachment`.
* **`POST /api/v1/receipts/:tripId/resend` (Reenvío RF-8.4):** Responde `202 Accepted` registrando el intento en el historial.
* **Manejo uniforme de errores (RNF-05):** Validación de respuestas ante payloads malformados (`422 Unprocessable Entity`) y recursos inexistentes (`404 Not Found`).

---

## 3. Prueba de Concurrencia e Idempotencia (RNF-08 / RNF-09)

Uno de los requerimientos no funcionales críticos del Módulo 8 es que **un mismo viaje no debe emitir comprobantes duplicados ni corromper archivos** ante llamadas concurrentes (por ejemplo, reintentos de red de la app de conductor o del módulo de viajes M6).

### 3.1. Mecanismo de Protección Implementado
1. **Candado en Memoria (`withLock(tripId)`):** Serializa las peticiones entrantes que compiten por el mismo viaje dentro del proceso Node.js.
2. **Escritura Atómica en Almacenamiento:**
   - La creación de metadatos se realiza con la bandera exclusiva `wx` del sistema de archivos (`O_CREAT | O_EXCL`), impidiendo sobreescrituras en disco.
   - El archivo PDF se redacta primero en un archivo temporal (`.tmp`) y se promueve a definitivo (`renameSync`) únicamente cuando el metadato ha quedado asegurado.

### 3.2. Metodología de la Prueba de Estrés
El script `scripts/prueba-concurrencia.mjs` ejecuta:
1. Sincronización previa esperando respuesta exitosa de `/health`.
2. Generación de un identificador dinámico de prueba `trip-concurrencia-<timestamp>`.
3. Disparo simultáneo mediante `Promise.all` de **8 solicitudes HTTP concurrentes** con el mismo cuerpo de viaje finalizado.

### 3.3. Resultados de la Verificación

```
========================================================================
 PRUEBA DE CONCURRENCIA E IDEMPOTENCIA - M8 Comprobantes
 RF-8.3 (Comprobante PDF) | RNF-09 (Consistencia y concurrencia)
========================================================================
 Endpoint    : POST http://localhost:3008/api/v1/receipts
 Solicitudes : 8 simultaneas sobre el mismo viaje
------------------------------------------------------------------------
 [1/8] HTTP 201 Created (Comprobante emitido exitosamente)
 [2/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [3/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [4/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [5/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [6/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [7/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
 [8/8] HTTP 200 OK      (Idempotente: comprobante existente devuelto)
------------------------------------------------------------------------
 Validacion:
  - 1 emision original (HTTP 201)
  - 7 respuestas idempotentes (HTTP 200)
  - Mismo receiptId retornado en las 8 llamadas
  - 1 unico archivo PDF creado en disco sin corrupcion
 ESTADO: PRUEBA SUPERADA CON EXITO
========================================================================
```

---

## 4. Métricas de Rendimiento (Generación de PDF)

Gracias al uso de **PDFKit** en memoria (evitando motores de renderizado pesados como Puppeteer o Chromium):
* **Mediana de generación:** **3,3 ms**.
* **Percentil 95 (P95):** **6,3 ms** (evaluado sobre 30 muestras de documentos A4).
* **Tiempo total de ejecución de los 22 tests:** **~1 segundo**.
