# M8 — Notificaciones, Documentos y Soporte

Servicio integrado del Grupo 6 para la entrega AE1 de Paradigmas III. Implementa:

- **RF-8.1 — Notificaciones de viaje:** `POST /notifications` procesa un acontecimiento de viaje ya ocurrido, genera el mensaje en M8 y procesa el canal `PUSH` mediante un proveedor mock durante AE1.
- **RF-8.2 — QR de verificación:** `POST /qr` genera un QR temporal y `POST /qr/validate` lo valida y consume una sola vez.

M8 no administra el ciclo de vida del viaje: no crea viajes ni cambia estados, incluido `EN_CURSO`. M6 recibe el resultado de la validación QR y decide cualquier transición posterior.

## Tecnologías

- Node.js 24, TypeScript y Express.
- pnpm 10.33.0 como único gestor de paquetes.
- Vitest y Supertest para pruebas unitarias e integración.
- Playwright con Chromium para pruebas E2E de interfaz.
- Docker y Docker Compose.
- OpenAPI y Swagger UI local.
- `qrcode` para la representación QR PNG.

## Arquitectura

```text
RF-8.1
HTTP → Controller → Validator → NotificationService → PushProvider → MockPushProvider (AE1)

RF-8.2
HTTP → Controller → Validator → QrService → QrStore → InMemoryQrStore (AE1)
                                      ├→ generador QR
                                      └→ configuración QR_TTL_SECONDS
```

RF-8.1 recibe `tripId`, `recipientId`, `eventType` y el canal `PUSH`. Reconoce seis acontecimientos de viaje y genera el texto de la notificación dentro de M8; el mock reemplaza únicamente al proveedor PUSH externo.

RF-8.2 genera un token opaco criptográficamente seguro, entrega una representación QR que codifica solo ese token y conserva su hash SHA-256 asociado al `tripId`. El QR tiene TTL configurable y una validación exitosa lo consume; el almacenamiento en memoria realiza ese consumo de forma atómica para la única instancia Node de AE1.

## Requisitos previos

- Git.
- Node.js compatible con la versión 24.
- pnpm 10.33.0.
- Docker Engine o Docker Desktop con Docker Compose.
- Para E2E UI, Chromium de Playwright:

  ```powershell
  pnpm exec playwright install chromium
  ```

Usar exclusivamente `pnpm`; el repositorio no utiliza npm ni yarn.

## Instalación y configuración

Instalar exactamente las dependencias bloqueadas:

```powershell
pnpm install --frozen-lockfile
```

La configuración de ejemplo está en `.env.example`:

```powershell
Copy-Item .env.example .env
```

Crear `.env` es opcional: Docker Compose dispone de valores por defecto.

- `M8_HOST_PORT` define el puerto publicado por Docker Compose.
- `PORT` define el puerto de Node al ejecutar localmente fuera de Compose.
- Docker Compose mantiene intencionalmente el puerto interno del contenedor en `3000`.
- `QR_TTL_SECONDS` define la vigencia de los QR temporales en segundos.

## Ejecución local sin Docker

```powershell
pnpm dev
```

Para compilar y ejecutar la versión compilada:

```powershell
pnpm build
pnpm start
```

## Ejecución recomendada con Docker Compose

```powershell
docker compose config
docker compose up -d --build
docker compose ps
```

Con la configuración por defecto, el servicio queda disponible en:

- UI de demostración: <http://localhost:3000/>
- Health: <http://localhost:3000/health>
- Contrato OpenAPI: <http://localhost:3000/openapi.yaml>
- Swagger UI local: <http://localhost:3000/api-docs/>

Si se modifica `M8_HOST_PORT`, reemplazar `3000` por ese valor en las URLs.

## API y UI

La fuente de verdad del contrato HTTP es [`docs/api/openapi.yaml`](docs/api/openapi.yaml). Swagger UI se sirve localmente desde `/api-docs/`, sin recursos CDN.

| Operación | Propósito |
| --- | --- |
| `POST /notifications` | Procesa una notificación de viaje para RF-8.1. |
| `POST /qr` | Genera un QR temporal asociado a un viaje. |
| `POST /qr/validate` | Valida y consume un QR. |
| `GET /health` | Expone disponibilidad técnica del servicio. |

`GET /` sirve una interfaz técnica de demostración de M8, no la UI final del sistema. Permite demostrar RF-8.1 y simular el flujo pasajero/conductor de RF-8.2: genera un QR visual, muestra su TTL, permite validarlo y evidencia el rechazo al reuso. Simula al módulo externo que enviaría el evento de viaje, pero no sustituye una integración real con M6.

## Pruebas y verificaciones

```powershell
pnpm typecheck
pnpm typecheck:test
pnpm build
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm test:e2e:api
pnpm test:e2e:ui
pnpm test:e2e
```

La verificación integrada actual incluye 122 pruebas unitarias, 55 de integración, 177 unitarias e integración combinadas, 24 E2E API y 2 E2E UI: 26/26 E2E y 203 pruebas automatizadas. La cobertura integrada es 99.52% en statements y lines, 99.02% en branches y 100% en functions.

Las E2E API y UI usan configuraciones separadas (Vitest y Playwright), pero ambas reutilizan `tests/e2e/infrastructure/docker-service.ts`: levantan un contenedor Docker temporal con puerto host dinámico y lo eliminan al finalizar. Consultar [tests/README.md](tests/README.md) y [tests/CATALOGO_PRUEBAS.md](tests/CATALOGO_PRUEBAS.md) para el detalle.

## Logs y limpieza local

```powershell
docker compose logs
docker compose down --remove-orphans
```

Estos comandos inspeccionan y detienen únicamente los recursos de este Compose; no usar operaciones globales de limpieza de Docker.

## Estructura relevante

```text
src/           Aplicación Express, dominios notifications y qr, y errores compartidos.
public/        UI de demostración y Swagger UI local.
docs/api/      Contrato OpenAPI.
docs/m8/       Alcance, decisiones y especificaciones funcionales del módulo.
tests/         Pruebas unitarias, integración, E2E API y E2E UI.
Dockerfile     Imagen multi-stage del servicio M8.
compose.yaml   Ejecución local reproducible con Docker Compose.
.env.example   Variables de configuración de ejemplo.
```

## Límites conscientes de AE1

- `MockPushProvider` sustituye solo el proveedor PUSH externo; no acredita entrega real.
- `InMemoryQrStore` es temporal y se pierde al reiniciar; una persistencia distribuida queda para una etapa posterior.
- No hay RabbitMQ, Redis, base de datos, proveedores PUSH reales, autenticación propia ni integración real con M6.
- La integración futura se realiza reemplazando adaptadores externos, sin trasladar a M8 la lógica de viajes.
