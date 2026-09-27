# Alcance del Módulo 8 — Grupo 6

## Propósito

El servicio M8 integrado implementa en AE1 los requerimientos RF-8.1 — Notificaciones de viaje — y RF-8.2 — QR de verificación. Su contrato HTTP se define en `docs/api/openapi.yaml`.

## RF-8.1 — Notificaciones de viaje

M8 recibe un acontecimiento de viaje ya ocurrido mediante `POST /notifications`, valida la entrada, genera el mensaje correspondiente al `eventType` y procesa el canal configurado.

Durante AE1 el único canal es `PUSH` y el proveedor externo se reemplaza por un mock. El estado `PROCESSED` confirma que M8 validó, generó y procesó la notificación con ese proveedor simulado; no confirma una entrega real en el dispositivo.

La interfaz servida en `GET /` es una demostración de RF-8.1. Simula al módulo externo que, en la integración real, enviará el evento automáticamente.

## RF-8.2 — QR de verificación

M8 genera QR temporales mediante `POST /qr` y los valida y consume mediante `POST /qr/validate`.

El QR representa únicamente un token opaco y criptográficamente seguro. M8 conserva internamente la asociación mínima con `tripId`, el hash del token, creación, vencimiento y uso. La validación comprueba existencia, asociación, vigencia y uso previo; una validación exitosa consume el QR y dos solicitudes concurrentes no pueden validarlo ambas.

El TTL se configura externamente con `QR_TTL_SECONDS`. Durante AE1 el almacenamiento QR es en memoria y se pierde al reiniciar el servicio.

## Límite con M6

M6 administra el ciclo de vida del viaje. M8 no crea viajes, no guarda su información completa y no modifica estados; en particular, nunca cambia un viaje a `EN_CURSO`.

Flujo conceptual de QR:

```text
M6 solicita generación → M8 genera QR → usuario presenta QR
→ M6 solicita validación → M8 valida y consume → M6 decide el inicio
```

Durante AE1 no existe integración real con M6. `tripId` representa la referencia externa mínima necesaria.

## Implementado en AE1

- API contract-first para los tres endpoints de M8.
- Validación runtime y respuestas de error uniformes.
- Procesamiento PUSH mock y UI de demostración de RF-8.1.
- Token criptográfico, hash SHA-256, representación QR real, TTL y uso único para RF-8.2.
- Pruebas unitarias, integración y E2E API/UI contra imágenes Docker temporales con orquestación compartida.
- `GET /health`, el contrato OpenAPI y Swagger UI local para verificar la disponibilidad y el contrato del servicio.

## Fuera de alcance

- Gestión de viajes, usuarios, pagos, tarifas o estados de M6.
- Entrega PUSH real, EMAIL, SMS e historial de notificaciones.
- Base de datos, Redis, RabbitMQ y despliegue cloud.
- Autenticación propia, aplicación móvil o frontend de escaneo.
- RF-8.3, RF-8.4, RF-8.5 y RF-8.6.
