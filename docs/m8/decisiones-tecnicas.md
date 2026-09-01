# Decisiones técnicas — M8 integrado

## Propósito

Este documento registra la arquitectura efectiva del servicio M8 integrado del Grupo 6. El contrato HTTP aprobado se encuentra en `docs/api/openapi.yaml`.

## Servicio único

M8 es una única aplicación Node.js 24 con TypeScript y Express. `src/app.ts` compone los endpoints, los recursos públicos de RF-8.1 y el manejo común de errores; `src/server.ts` es el único punto de arranque HTTP y obtiene `PORT` desde el entorno.

La estructura relevante es:

```text
src/
├── notifications/  # RF-8.1
├── qr/             # RF-8.2
├── shared/         # errores HTTP compartidos
├── app.ts
└── server.ts
```

No se crean servicios independientes para QR o notificaciones.

## RF-8.1

`src/notifications/**` contiene validación, generación del mensaje, procesamiento y el contrato `PushProvider`. La composición usa `MockPushProvider` durante AE1; ese mock reemplaza solamente al proveedor externo, no la lógica de M8.

La UI estática de demostración se sirve desde `public/`. `GET /openapi.yaml` expone el contrato para revisión local.

## RF-8.2

`src/qr/**` separa validación, configuración, generación, store, service y controller. El token se genera con mecanismos criptográficamente seguros de Node.js y su relación interna se conserva mediante SHA-256 (`tokenHash`). La librería `qrcode` genera una Data URL PNG que codifica únicamente el token opaco.

El store en memoria usa la información mínima propia de M8: identificador, `tripId`, hash, creación, vencimiento y uso. No sustituye una persistencia futura y se pierde al reiniciar. En la única instancia Node de AE1, el consumo se realiza sin operaciones asíncronas entre comprobar y marcar el QR, preservando el uso único para solicitudes concurrentes.

`QR_TTL_SECONDS` configura externamente la vigencia; el valor por defecto de desarrollo es 300 segundos. La configuración se valida al componer las rutas QR.

## Errores y contratos

`src/shared/api-error.ts` define `ApiError`, `ErrorDetail` y `ErrorResponse` neutrales. `src/shared/error-handler.ts` conserva el formato uniforme, transforma JSON malformado en `VALIDATION_ERROR`, respeta errores de dominio y mantiene un fallback 500 seguro.

Cada dominio clasifica sus fallas de procesamiento: RF-8.1 usa `NOTIFICATION_PROCESSING_ERROR` y RF-8.2 usa `QR_PROCESSING_ERROR`. El fallback `INTERNAL_SERVER_ERROR` es una salvaguarda interna y no amplía el contrato OpenAPI.

## Dependencias y herramientas

El proyecto usa pnpm 10.33.0 como único gestor. Las dependencias de ejecución son Express y `qrcode`; TypeScript, Vitest, Supertest, `jsqr`, `pngjs` y sus tipos se usan en desarrollo y pruebas.

No se agregan Redis, RabbitMQ, ORM ni base de datos para AE1.

## Pruebas

Vitest organiza los proyectos `unit`, `integration` y `e2e`. Supertest cubre los endpoints en integración. La cobertura se calcula sobre el código integrado.

Las E2E comparten un único `globalSetup`: construye una única imagen Docker, crea un único contenedor temporal con puerto host dinámico, provee `e2eBaseUrl` y lo elimina al finalizar. Ambos RF realizan HTTP real contra ese mismo servicio; el contenedor recibe `QR_TTL_SECONDS=120` para verificar configuración QR.

## Docker

El Dockerfile multi-stage usa Node.js 24 Alpine y pnpm 10.33.0. Instala con `--frozen-lockfile`, compila TypeScript y ejecuta en runtime solamente con dependencias de producción, `NODE_ENV=production`, usuario `node` y `node dist/server.js`.

La imagen copia `public/` y `docs/api/openapi.yaml`, por lo que puede servir la UI y el contrato además de los tres endpoints.

## Límites

M8 no integra M6 directamente ni modifica estados de viaje. No se adelantan CI/CD, despliegue cloud, observabilidad avanzada, RabbitMQ, Redis ni persistencia distribuida propios de etapas posteriores.
