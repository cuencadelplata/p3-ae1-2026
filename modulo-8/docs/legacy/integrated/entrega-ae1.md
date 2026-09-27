# Entrega AE1 — M8 integrado, Grupo 6

## Alcance entregado

La entrega integra RF-8.1 — Notificaciones de viaje — y RF-8.2 — QR de verificación en un único servicio M8.

- RF-8.1: `POST /notifications`, generación de mensajes, PUSH mock y UI de demostración.
- RF-8.2: `POST /qr`, `POST /qr/validate`, token opaco criptográfico, QR PNG real, TTL, hash SHA-256, asociación con `tripId` y uso único.

M8 no modifica el viaje a `EN_CURSO`; esa decisión sigue siendo responsabilidad de M6.

El contrato completo y sus ejemplos están en `docs/api/openapi.yaml`.

## Verificaciones ejecutadas

| Verificación | Resultado |
| --- | --- |
| Unit | `122/122` |
| Integration | `55/55` |
| Unit + Integration | `177/177` |
| E2E API Docker | `24/24` |
| E2E UI Docker + Playwright | `2/2` |
| E2E total | `26/26` |
| Total automatizado | `203` |
| Typecheck | OK |
| Typecheck de tests | OK |
| Build | OK |
| Docker build | OK |

Cobertura integrada:

| Métrica | Resultado |
| --- | --- |
| Statements | `99.52% (208/209)` |
| Branches | `99.02% (102/103)` |
| Functions | `100% (41/41)` |
| Lines | `99.52% (208/209)` |

La diferencia respecto de 100% corresponde al fallback genérico seguro de `error-handler`, separado de los errores de dominio de notificaciones y QR.

## Ejecución reproducible

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:test
pnpm build
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm test:e2e
```

`pnpm test:e2e` ejecuta E2E API y E2E UI. Ambas configuraciones reutilizan la infraestructura Docker compartida, levantan un contenedor temporal con puerto host dinámico y lo eliminan al finalizar. Los flujos verifican notificaciones, UI, recursos públicos, health, OpenAPI, Swagger UI y el ciclo QR generar → validar → reutilizar.

## Docker integrado

La imagen única incluye el backend, la UI de RF-8.1 y el contrato OpenAPI.

```powershell
docker build -t m8-service:local .
docker run --rm -e PORT=3000 -e QR_TTL_SECONDS=300 -p 3010:3000 m8-service:local
```

`PORT` y `QR_TTL_SECONDS` se configuran externamente. Para E2E, el contenedor recibe `QR_TTL_SECONDS=120` y un puerto host dinámico.

## Límites declarados

- No hay integración real con M6; `tripId` es la referencia externa mínima.
- PUSH usa un proveedor simulado en AE1; no confirma entrega en un dispositivo.
- El almacenamiento QR es temporal en memoria; no existe base de datos, Redis ni RabbitMQ.
- No se implementan EMAIL, SMS, historial de notificaciones, autenticación propia, pagos, usuarios ni otros RF de M8.
- GitHub Actions CI valida la branch de integración; no existe publicación en Docker Hub ni despliegue cloud.
