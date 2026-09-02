# Catálogo de pruebas de M8

Este catálogo permite ubicar rápidamente los escenarios comprobados. Los nombres técnicos de endpoints, códigos y tipos se conservan para facilitar la relación con el contrato OpenAPI.

## ¿Dónde busco una prueba?

| Quiero comprobar | Archivo principal |
| --- | --- |
| Validación de entrada QR | `tests/unit/qr/qr.validator.test.ts` |
| Reglas principales y validación QR | `tests/unit/qr/qr.service.test.ts` |
| TTL y configuración QR | `tests/unit/qr/qr.config.test.ts` |
| Generación de imagen QR | `tests/unit/qr/qr-generator.test.ts` |
| Almacenamiento, single-use o QR reutilizado | `tests/unit/qr/qr.store.test.ts` |
| Concurrencia de validaciones QR | `tests/integration/qr/qr.integration.test.ts` |
| Validación de notificaciones | `tests/unit/notifications/notification.validator.test.ts` |
| Lógica y mensajes de notificaciones | `tests/unit/notifications/notification.service.test.ts` |
| Integración HTTP RF-8.1 | `tests/integration/notifications/notifications.integration.test.ts` |
| Integración HTTP RF-8.2 | `tests/integration/qr/qr.integration.test.ts` |
| E2E API RF-8.1 | `tests/e2e/api/notifications.e2e.test.ts` |
| E2E API RF-8.2 | `tests/e2e/api/qr.e2e.test.ts` |
| E2E visual Playwright | `tests/e2e/ui/m8.ui.e2e.test.ts` |
| Disponibilidad técnica del servicio | `tests/integration/health/health.integration.test.ts` |
| Health contra Docker | `tests/e2e/api/health.e2e.test.ts` |

## Disponibilidad técnica

### Integración

#### `tests/integration/health/health.integration.test.ts`

Tipo: Integration. RF: infraestructura compartida.

Verifica que `GET /health` responda `200`, use JSON y devuelva el estado estable `ok` sin ejecutar reglas de negocio.

### E2E API

#### `tests/e2e/api/health.e2e.test.ts`

Tipo: E2E API. RF: infraestructura compartida.

Verifica `GET /health` contra el servicio M8 real dentro de Docker. También es la operación usada para readiness de los E2E.

## RF-8.1 — Notificaciones

### Unit

#### `tests/unit/notifications/notification.service.test.ts`

Tipo: Unit. RF: RF-8.1.

Verifica:

- procesamiento posterior al proveedor PUSH;
- mensajes para los seis `eventType`, incluidos `TRIP_REQUESTED` y `DRIVER_ASSIGNED`;
- propagación de fallos del proveedor;
- que no se devuelva `PROCESSED` antes de completar `MockPushProvider`.

#### `tests/unit/notifications/notification.validator.test.ts`

Tipo: Unit. RF: RF-8.1.

Verifica:

- `tripId`, `recipientId`, `eventType` y `channels`;
- errores de validación por propiedades adicionales;
- acumulación de detalles y ausencia de normalización silenciosa.

### Integración

#### `tests/integration/notifications/notifications.integration.test.ts`

Tipo: Integration. RF: RF-8.1.

Verifica:

- endpoint HTTP `POST /notifications` y éxito `201`;
- errores de validación, JSON malformado y media type;
- fallo del proveedor y composición con `MockPushProvider`;
- recursos públicos de la interfaz visual y OpenAPI.

### E2E API

#### `tests/e2e/api/notifications.e2e.test.ts`

Tipo: E2E API. RF: RF-8.1.

Verifica:

- endpoint HTTP real para eventos RF-8.1, incluidos `TRIP_REQUESTED` y `DRIVER_ASSIGNED`;
- errores públicos seguros de validación y media type;
- disponibilidad de interfaz visual, CSS, JavaScript y OpenAPI desde Docker.

## RF-8.2 — QR de verificación

### Unit

#### `tests/unit/qr/qr.config.test.ts`

Tipo: Unit. RF: RF-8.2. Verifica la lectura y validación de `QR_TTL_SECONDS`, incluido el valor por defecto y límites inválidos.

#### `tests/unit/qr/qr.controller.test.ts`

Tipo: Unit. RF: RF-8.2. Verifica handlers de generación QR y validación QR: media type, validación, respuestas del contrato y propagación de `ApiError`.

#### `tests/unit/qr/qr-generator.test.ts`

Tipo: Unit. RF: RF-8.2. Verifica generación QR con token criptográfico, hash SHA-256, Data URL PNG y que el QR codifique exclusivamente el token opaco.

#### `tests/unit/qr/qr.service.test.ts`

Tipo: Unit. RF: RF-8.2. Verifica generación QR, hash sin texto plano persistido, TTL, respuesta de QR y traducción segura de errores del generador.

#### `tests/unit/qr/qr.store.test.ts`

Tipo: Unit. RF: RF-8.2.

Verifica:

- asociación con `tripId` e inexistencia;
- QR expirado y prioridad de QR ya usado;
- single-use o consumo único.

#### `tests/unit/qr/qr.validator.test.ts`

Tipo: Unit. RF: RF-8.2. Verifica los cuerpos de generación QR y validación QR, mínimos de longitud, propiedades adicionales y detalles acumulados.

### Integración y concurrencia

#### `tests/integration/qr/qr.integration.test.ts`

Tipo: Integration. RF: RF-8.2.

Verifica:

- endpoints HTTP `POST /qr` y `POST /qr/validate`;
- generación QR, validación QR y `QR_NOT_FOUND`;
- single-use, QR reutilizado y `QR_ALREADY_USED`;
- concurrencia de validaciones HTTP del mismo QR.

### E2E API

#### `tests/e2e/api/qr.e2e.test.ts`

Tipo: E2E API. RF: RF-8.2. Contra Docker y HTTP real, verifica generación QR, TTL configurado, validación QR, QR reutilizado y rechazo `QR_ALREADY_USED`.

## E2E UI integrada

#### `tests/e2e/ui/m8.ui.e2e.test.ts`

Tipo: E2E UI. RF: RF-8.1 y RF-8.2. Con Chromium y Docker, verifica la interfaz visual: procesa una notificación, genera un QR visible con countdown, lo valida, confirma su consumo y muestra el rechazo por reutilización.

## Infraestructura compartida

#### `tests/e2e/infrastructure/docker-service.ts`

Soporte E2E. Construye la imagen, levanta un contenedor temporal con puerto host dinámico, espera disponibilidad mediante HTTP real y elimina únicamente ese contenedor.

#### `tests/e2e/infrastructure/docker-global-setup.ts`

Soporte Vitest. Entrega `e2eBaseUrl` a las pruebas API y registra el teardown del contenedor.

#### `tests/e2e/infrastructure/playwright-global-setup.ts`

Soporte Playwright. Entrega `M8_E2E_BASE_URL` a la prueba UI y registra el teardown del contenedor.

#### `tests/e2e/infrastructure/vitest-context.ts`

Soporte de tipos. Declara el contexto provisto por Vitest para las pruebas E2E API; no contiene lógica de negocio.
