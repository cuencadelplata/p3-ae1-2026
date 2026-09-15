# Especificación de la API REST y Contrato OpenAPI (M8)

**Materia:** ISI - Paradigmas de Programación 3 (2026)  
**Módulo:** M8 - Notificaciones, Documentos y Soporte (Comprobantes PDF)  
**Grupo 14:** Juan Gualtieri, Lucas Cremaschi, Meza Santiago  
**Base URL:** `http://localhost:3008/api/v1`  
**Consola Interactiva:** `http://localhost:3008/docs` (Scalar API Reference)  

---

## 1. Documentación Interactiva y Contratos OpenAPI 3.0

El microservicio publica formalmente su contrato en formato OpenAPI 3.0.3 en:
* **Consola interactiva Scalar:** `http://localhost:3008/docs` (o `/api/v1/docs`).
* **Especificación en JSON:** `http://localhost:3008/api/v1/docs/openapi.json`.
* **Especificación en YAML:** `http://localhost:3008/api/v1/docs/openapi.yaml`.

---

## 2. Detalle de Endpoints

### 2.1. `POST /api/v1/receipts` - Emisión de Comprobante (RF-8.3)

Emite el comprobante en PDF ante la finalización de un viaje.  
**Propiedad de Idempotencia:** Si se llama por primera vez con un `tripId`, emite el comprobante y responde `201 Created`. Si se reenvía la misma solicitud con el mismo `tripId`, responde `200 OK` devolviendo el comprobante preexistente sin duplicar archivos.

#### Payload de Entrada (Ejemplo):
```json
{
  "tripId": "trip-2026-000123",
  "customer": {
    "id": "cli-0091",
    "fullName": "Lucia Fernandez",
    "email": "lucia.fernandez@example.com",
    "documentId": "38.442.019"
  },
  "driver": {
    "id": "cnd-0457",
    "fullName": "Martin Rodriguez",
    "vehicle": {
      "type": "AUTO",
      "plate": "AB123CD",
      "model": "Toyota Etios 2021"
    }
  },
  "trip": {
    "origin": "Av. Colon 1250, Cordoba",
    "destination": "Aeropuerto Ambrosio Taravella",
    "startedAt": "2026-08-28T13:05:00.000Z",
    "finishedAt": "2026-08-28T13:36:00.000Z",
    "distanceKm": 14.8,
    "durationMin": 31
  },
  "fare": {
    "currency": "ARS",
    "baseFare": 1200,
    "distanceAmount": 5920,
    "timeAmount": 1550,
    "surcharges": 430,
    "discounts": 600,
    "total": 8500
  },
  "payment": {
    "method": "TARJETA",
    "status": "APROBADO",
    "authorizationCode": "AUTH-77321"
  }
}
```

#### Respuesta Exitosa (`201 Created` / `200 OK`):
```json
{
  "receipt": {
    "receiptId": "rec-20260828-e7f1a9",
    "tripId": "trip-2026-000123",
    "issuedAt": "2026-08-28T13:36:05.120Z",
    "fareTotal": 8500,
    "currency": "ARS",
    "downloadUrl": "http://localhost:3008/api/v1/receipts/trip-2026-000123/pdf",
    "staticPdfUrl": "http://localhost:3008/files/receipts/trip-2026-000123.pdf"
  }
}
```

---

### 2.2. `GET /api/v1/receipts/:tripId` - Consulta de Metadatos

Recupera los metadatos completos del comprobante emitido, su estado y el historial de envíos.

#### Respuesta (`200 OK`):
```json
{
  "receipt": {
    "receiptId": "rec-20260828-e7f1a9",
    "tripId": "trip-2026-000123",
    "issuedAt": "2026-08-28T13:36:05.120Z",
    "customer": { "fullName": "Lucia Fernandez", "email": "lucia.fernandez@example.com" },
    "fare": { "currency": "ARS", "total": 8500 },
    "deliveries": [
      {
        "channel": "EMAIL",
        "destination": "lucia.fernandez@example.com",
        "sentAt": "2026-08-28T13:36:05.200Z",
        "status": "ENTREGADO"
      }
    ],
    "links": {
      "pdf": "http://localhost:3008/api/v1/receipts/trip-2026-000123/pdf",
      "static": "http://localhost:3008/files/receipts/trip-2026-000123.pdf"
    }
  }
}
```

---

### 2.3. `GET /api/v1/receipts/:tripId/pdf` - Descarga Directa del PDF

Descarga controlada del comprobante binario con cabeceras:
* `Content-Type: application/pdf`
* `Content-Disposition: attachment; filename="comprobante-trip-2026-000123.pdf"`

---

### 2.4. `POST /api/v1/receipts/:tripId/resend` - Reenvío de Comprobante (RF-8.4)

Permite reenviar el comprobante por correo electrónico, SMS o notificación Push.

#### Payload Opcional:
```json
{
  "channel": "EMAIL",
  "destination": "nuevo_correo@example.com"
}
```
*(Si no se envía cuerpo, utiliza automáticamente el email registrado del cliente).*

#### Respuesta (`202 Accepted`):
```json
{
  "message": "Comprobante reenviado con éxito",
  "delivery": {
    "channel": "EMAIL",
    "destination": "nuevo_correo@example.com",
    "sentAt": "2026-08-28T14:10:00.000Z",
    "status": "ENVIADO"
  }
}
```

---

### 2.5. `GET /health` - Verificación de Salud (Healthcheck)

Endpoint raíz fuera del prefijo `/api/v1` para integración con balanceadores y `HEALTHCHECK` de Docker.

#### Respuesta (`200 OK`):
```json
{
  "status": "ok",
  "service": "m8-documentos",
  "version": "1.0.0",
  "storage": "available",
  "timestamp": "2026-09-14T20:00:00.000Z"
}
```

---

## 3. Formato Estandarizado de Errores (RNF-05)

Todas las respuestas de error respetan un esquema uniforme:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "El cuerpo de la solicitud no cumple el contrato",
    "details": ["driver.vehicle.type debe ser AUTO o MOTO"],
    "path": "/api/v1/receipts",
    "timestamp": "2026-09-14T20:00:00.000Z"
  }
}
```

| Código de Error | HTTP Status | Situación |
| :--- | :--- | :--- |
| `VALIDATION_ERROR` | `422 Unprocessable Entity` | Datos con tipos o valores inválidos. |
| `INVALID_TRIP_ID` | `400 Bad Request` | El `tripId` en la URL contiene caracteres ilegales. |
| `MALFORMED_JSON` | `400 Bad Request` | Sintaxis JSON rota en la petición. |
| `RECEIPT_NOT_FOUND` | `404 Not Found` | No existe comprobante generado para ese `tripId`. |
| `RECEIPT_PDF_UNAVAILABLE` | `409 Conflict` | Existen los metadatos pero falta el archivo físico PDF. |
| `INTERNAL_ERROR` | `500 Internal Server Error` | Excepción no controlada del servidor. |
