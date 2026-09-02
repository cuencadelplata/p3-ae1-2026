# M8 — Notificaciones y QR
Implementación AE1 - GRUPO 6 - MÓDULO 8
RF-8.1 — Notificaciones de viaje.
RF-8.2 — QR de verificación.

## Alcance

Este servicio integrado implementa en AE1:

- **RF-8.1 — Notificaciones de viaje:** recibe y procesa acontecimientos de viaje, reconoce los seis acontecimientos definidos para el requisito, genera el mensaje dentro de M8 y procesa el canal `PUSH` mediante `PushProvider`. En AE1, `MockPushProvider` sustituye únicamente al proveedor PUSH externo.
- **RF-8.2 — QR de verificación:** genera un QR temporal asociado a un `tripId`, lo valida y lo consume una sola vez.

M8 procesa notificaciones y genera, valida y consume QR. No inicia viajes, no cambia un viaje a `EN_CURSO` ni administra la máquina de estados. M6 decide las transiciones posteriores del viaje.

## Tecnologías

- Node.js 24, TypeScript y Express.
- pnpm 10.33.0 como único gestor de paquetes.
- Vitest y Supertest para pruebas unitarias e integración.
- Playwright con Chromium para E2E UI.
- Docker y Docker Compose.
- OpenAPI, Swagger UI local y `qrcode`.

## Requisitos previos
- Git.
- Node.js 24.
- pnpm 10.33.0.
- Docker Desktop o Docker Engine con Docker Compose.

Usar exclusivamente `pnpm`; el repositorio no utiliza npm ni yarn.

## Ejecución recomendada paso a paso

Esta es la guía canónica para reproducir AE1 desde un clon limpio.

### 1. Instalar dependencias

```powershell
pnpm install --frozen-lockfile
```

Resultado esperado: dependencias instaladas correctamente y lockfile respetado.

### 2. Realizar la verificación técnica

```powershell
pnpm typecheck
pnpm typecheck:test
pnpm build
```

Resultado esperado: typecheck de aplicación y tests correctos, build correcto y `dist/` generado.

### 3. Ejecutar pruebas Unit, Integration y Coverage

```powershell
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage
```

Resultados comprobados: Unit `122/122`, Integration `55/55` y Unit + Integration `177/177`.

Coverage: Statements `99.52%`, Lines `99.52%`, Branches `99.02%` y Functions `100%`.

### 4. Preparar Playwright

```powershell
pnpm exec playwright install chromium
```

Instala o verifica Chromium, necesario para E2E UI; si ya está instalado, puede finalizar sin descargar nada.

### 5. Ejecutar pruebas E2E

```powershell
pnpm test:e2e
```

El comando principal ejecuta E2E API y E2E UI mediante contenedores Docker temporales reales, que se eliminan al finalizar. También se pueden ejecutar por separado con `pnpm test:e2e:api` y `pnpm test:e2e:ui`.

Resultados comprobados: E2E API `24/24`, E2E UI `2/2` y E2E total `26/26`. Junto con `177` pruebas Unit + Integration, suman `203` pruebas automatizadas.

### 6. Validar Docker Compose

```powershell
docker compose config
```

Resultado esperado: configuración válida, servicio `m8`, puerto host por defecto `3000` y `QR_TTL_SECONDS` por defecto `300`.

### 7. Levantar M8

```powershell
docker compose up -d --build
docker compose ps
```

Resultado esperado: la imagen local `m8-notificaciones-qr:1.0.0` configurada en `compose.yaml` se construye, el servicio `m8` queda ejecutándose y `healthy`, con puerto host `3000` por defecto. Este tag es local de Compose; no implica una release pública ni una imagen publicada en Docker Hub.

Si se modifica `M8_HOST_PORT`, usar ese puerto en las URLs siguientes.

### 8. Verificar aplicación y requerimientos

- <http://localhost:3000/> — interfaz técnica de demostración de M8.
- <http://localhost:3000/health> — disponibilidad del servicio; responde HTTP 200 y `status: "ok"`.
- <http://localhost:3000/openapi.yaml> — contrato OpenAPI fuente.
- <http://localhost:3000/api-docs/> — Swagger UI interactivo local.

Resultado esperado: los cuatro recursos responden desde el servicio levantado. Usar la demo o Swagger UI para los payloads, schemas y errores detallados de OpenAPI.

- RF-8.1: una notificación válida se procesa con estado `PROCESSED`.
- RF-8.2: se genera un QR temporal, se valida una vez y el reuso se rechaza con `QR_ALREADY_USED`.

### 9. Revisar logs

```powershell
docker compose logs
```

Resultado esperado: el servicio registra su arranque, por ejemplo `M8 service listening on port 3000`.

### 10. Detener y limpiar

```powershell
docker compose down --remove-orphans
docker compose ps
```

Resultado esperado: se eliminan el contenedor M8 y la red de Compose, y `docker compose ps` no muestra servicios activos. No usar limpiezas globales como `docker system prune`.

## Configuración

`.env.example` documenta las variables disponibles. Crear `.env` es opcional porque Docker Compose tiene valores por defecto:

```powershell
Copy-Item .env.example .env
```

- `M8_HOST_PORT`: puerto del host publicado por Docker Compose.
- `PORT`: puerto de Node al ejecutar localmente fuera de Compose.
- Docker Compose mantiene internamente M8 en el puerto `3000`.
- `QR_TTL_SECONDS`: vida útil de los QR temporales, en segundos.

## API y UI

La fuente de verdad del contrato HTTP es [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

| Operación | Propósito |
| --- | --- |
| `GET /health` | Disponibilidad técnica del servicio. |
| `POST /notifications` | Procesamiento de notificaciones de RF-8.1. |
| `POST /qr` | Generación de QR temporal asociado a un viaje. |
| `POST /qr/validate` | Validación y consumo de QR. |

`GET /` sirve la demo técnica de M8. `/openapi.yaml` expone el contrato y `/api-docs/` sirve Swagger UI interactivo local: utiliza assets locales, no depende de CDN y consume `/openapi.yaml`.

## Pruebas y resultados

- **Unit:** valida reglas aisladas de notificaciones, QR y componentes compartidos (`122/122`).
- **Integration:** verifica rutas HTTP mediante Supertest (`55/55`).
- **E2E API:** consume HTTP real contra Docker (`24/24`).
- **E2E UI:** recorre la demo con Playwright y Chromium (`2/2`).

El total es `203` pruebas automatizadas: `177/177` unitarias e integración y `26/26` E2E. La cobertura integrada es Statements `99.52%`, Lines `99.52%`, Branches `99.02%` y Functions `100%`.

Las E2E API y UI usan setups separados de Vitest y Playwright, pero reutilizan `tests/e2e/infrastructure/docker-service.ts` para crear y eliminar contenedores Docker temporales con puerto host dinámico. GitHub Actions CI ejecuta los checks, build y pruebas de la branch de integración; no hay CD ni publicación de imágenes.

Ver [tests/README.md](tests/README.md) y [tests/CATALOGO_PRUEBAS.md](tests/CATALOGO_PRUEBAS.md) para el detalle de suites y casos.

## Ejecución local sin Docker

Alternativa al flujo recomendado con Docker Compose:

```powershell
pnpm dev
```

Para ejecutar la versión compilada:

```powershell
pnpm build
pnpm start
```

## Arquitectura

```text
RF-8.1
HTTP → Controller → Validator → NotificationService → PushProvider → MockPushProvider (AE1)

RF-8.2
HTTP → Controller → Validator → QrService → QrStore → InMemoryQrStore (AE1)
                                      ├→ generador QR
                                      └→ configuración QR_TTL_SECONDS
```

RF-8.1 genera sus mensajes dentro de M8 y conserva aislado el proveedor PUSH. RF-8.2 genera un token opaco criptográficamente seguro; la representación QR codifica únicamente ese token y no incorpora información sensible del viaje. Conserva su hash SHA-256 asociado al `tripId`, aplica TTL y lo consume una sola vez. En la única instancia Node de AE1, el consumo en memoria es atómico para solicitudes concurrentes. Estas abstracciones permiten reemplazar adaptadores sin reescribir las reglas principales.

## Estructura relevante

```text
src/           Aplicación Express, dominios notifications y qr, y errores compartidos.
public/        Demo técnica y Swagger UI local.
docs/api/      Contrato OpenAPI.
docs/m8/       Alcance, decisiones y especificaciones del módulo.
tests/         Unit, integration, E2E API y E2E UI.
Dockerfile     Imagen multi-stage del servicio M8.
compose.yaml   Ejecución local reproducible con Docker Compose.
.env.example   Variables de configuración de ejemplo.
```

## Límites conscientes de AE1

- `MockPushProvider` sustituye solo el proveedor PUSH externo; no acredita entrega real.
- `InMemoryQrStore` es temporal y se pierde al reiniciar.
- No hay RabbitMQ, Redis, CommunicationsDB ni otra base de datos, proveedores PUSH reales, autenticación propia ni integración real con M6.
- Las abstracciones actuales permiten sustituir o agregar adaptadores en etapas posteriores, sin presentar esa infraestructura futura como implementada.
