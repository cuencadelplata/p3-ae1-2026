# Entrega AE1 - Grupo 6

Esta guía permite reproducir localmente la entrega de RF-8.1. RF-8.2 se desarrolla en su branch específica y no se documenta como implementado aquí.

## Requisitos

- Una versión de Node.js compatible con el proyecto (el runtime de la imagen es Node.js 24 LTS).
- pnpm 10.33.0.
- Docker Desktop o Docker Engine para ejecutar Docker y las pruebas E2E.

## Instalación

```powershell
pnpm install --frozen-lockfile
```

## Verificación técnica

```powershell
pnpm typecheck
pnpm typecheck:test
pnpm build
```

## Pruebas

```powershell
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm test:e2e
```

Resultados actuales:

| Suite | Resultado |
| --- | --- |
| Unit | 53/53 |
| Integration | 38/38 |
| Unit + Integration | 91/91 |
| E2E Docker | 21/21 |
| Total automatizado | 112 |
| Coverage (unit + integration) | 100% |

## Ejecución local

```powershell
pnpm dev
```

El puerto predeterminado es `3000`. Recursos locales:

- UI: <http://127.0.0.1:3000/>
- OpenAPI: <http://127.0.0.1:3000/openapi.yaml>
- API: `POST http://127.0.0.1:3000/notifications`

El puerto se configura externamente mediante `PORT`. En Windows PowerShell:

```powershell
$env:PORT=3001
pnpm dev
Remove-Item Env:PORT
```

Ejemplo de cuerpo para `POST /notifications`:

```json
{
  "tripId": "trip-001",
  "recipientId": "user-001",
  "eventType": "DRIVER_ASSIGNED",
  "channels": ["PUSH"]
}
```

El cliente no envía `message`: M8 lo genera a partir del evento.

## Docker local

```powershell
docker build -t m8-notifications-service:local .
docker run --rm -e PORT=3000 -p 3010:3000 m8-notifications-service:local
```

Con ese ejemplo, los recursos están disponibles en:

- UI: <http://127.0.0.1:3010/>
- OpenAPI: <http://127.0.0.1:3010/openapi.yaml>
- API: `POST http://127.0.0.1:3010/notifications`

`3010` es solo un puerto de host de ejemplo; puede reemplazarse por cualquier puerto libre.

## E2E Docker

`pnpm test:e2e` realiza automáticamente estos pasos:

1. construye la imagen E2E;
2. crea un contenedor;
3. configura `PORT=3100` dentro del contenedor;
4. obtiene un puerto de host dinámico;
5. espera la disponibilidad HTTP;
6. ejecuta pruebas black-box mediante HTTP;
7. elimina el contenedor creado por esa ejecución.

## Test Explorer

Los proyectos Vitest `unit`, `integration` y `e2e` también pueden ejecutarse desde una IDE compatible con Vitest/Test Explorer. Al elegir un E2E, el `globalSetup` levanta Docker y el teardown realiza la limpieza. Los comandos `pnpm` son la referencia reproducible independiente de la IDE.

## Estado actual de entrega

| Elemento | Estado |
| --- | --- |
| Contrato OpenAPI | Completado |
| POST /notifications | Completado |
| UI GET / | Completado |
| OpenAPI GET /openapi.yaml | Completado |
| Mock PUSH | Completado |
| Unit tests | 53/53 |
| Integration tests | 38/38 |
| E2E Docker | 21/21 |
| Total automatizado | 112 |
| Coverage U+I | 100% |
| Docker local | Validado |
| Test Explorer | Validado |
| Docker Hub | Pendiente |

## Publicación Docker Hub

Estado: pendiente de la publicación final.

Después de los commits definitivos se deberá:

1. confirmar el usuario y repositorio de Docker Hub;
2. ejecutar `docker login`;
3. etiquetar la imagen definitiva;
4. ejecutar `docker push`;
5. verificar la publicación;
6. registrar el tag y digest como evidencia.

No se ejecutan hoy `docker login`, etiquetado de publicación ni `docker push`.

## Evidencia Git existente

Los commits existentes vinculados con RF-8.1 son:

- `dec819d` docs(m8): add project context and RF-8.1 guidelines
- `666383f` docs(m8): finalize RF-8.1 contract and AE1 scope
- `a7a1e17` chore(m8): initialize TypeScript Express service
- `e679e39` feat(m8): add RF-8.1 notification types and validation
- `3ae328e` feat(m8): implement RF-8.1 notification service
- `2fe463c` feat(m8): expose RF-8.1 notifications endpoint
- `c937e0d` test(m8): add RF-8.1 unit and integration tests
- `70f512c` build(m8): containerize RF-8.1 service
- `91c37f6` test(m8): integrate Docker E2E with Vitest projects
