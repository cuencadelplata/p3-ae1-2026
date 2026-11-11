# Runbook operativo de M8

Este documento describe el procedimiento reproducible de ejecución y prueba
del servicio integrado antes de generar `AE2-M08-ApellidoNombre.zip`.

## Preparación

Desde `modulo-8/`, crear el archivo local de configuración si todavía no
existe:

```powershell
Copy-Item .env.example .env
```

El archivo `.env` es local y no debe versionarse. Sus valores de M1 y M2 son
placeholders exclusivos de desarrollo. Antes de iniciar M8, reemplazar
`M1_JWT_SECRET` y `M2_INTERNAL_API_KEY` por valores locales propios; la app
rechaza los textos `replace-with-...`. Para integrar M1 y M2 reales, configurar
las credenciales acordadas con esos servicios fuera del repositorio.

## Inicio y comprobación

```powershell
pnpm install --frozen-lockfile
pnpm run build
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
Invoke-WebRequest http://localhost:3000/health/ready -UseBasicParsing
```

El resultado esperado del readiness es `200` con estado `ok`, o `degraded`/
`unavailable` cuando una dependencia no crítica/crítica no está disponible.

La aplicación se consulta en:

- `http://localhost:3000/docs`;
- `http://localhost:3000/openapi.yaml`;
- `http://localhost:3000/health/live`;
- `http://localhost:3000/health/ready`.

## Diagnóstico

Para revisar el proceso común:

```powershell
docker compose --env-file .env logs m8-app
docker compose --env-file .env logs postgres redis rabbitmq
```

`/health/live` solo confirma que Node sigue vivo. `/health/ready` expone el
estado agregado de los módulos y de sus dependencias, por lo que es la ruta
adecuada para diagnosticar disponibilidad.

En una base de datos nueva, los scripts de `infra/postgres/init/` crean los
roles y esquemas lógicos de M8. Si se reutiliza un volumen creado antes de
agregar un esquema, los scripts de inicialización de PostgreSQL no se ejecutan
automáticamente de nuevo; se debe aplicar el script de inicialización faltante
de forma controlada en el entorno local o recrear el volumen de desarrollo.

## Pruebas

```powershell
pnpm run test
pnpm run test:e2e
```

Las pruebas que publican mensajes RabbitMQ deben ejecutarse sin otro proceso
de M8 local consumiendo las mismas colas, para evitar competencia entre
consumidores de prueba y del servicio.

## Verificación de infraestructura compartida

Con Compose levantado, ejecutar:

```powershell
pnpm run test:infrastructure
```

La prueba comprueba PostgreSQL y los schemas lógicos `receipts`,
`notifications`, `support`, `notification_delivery` y `messaging`; realiza
`PING` a Redis; y verifica en RabbitMQ los exchanges `mobility.events` y
`mobility.events.dlx`.

## Prueba integrada de documento registrado

Esta prueba usa un publicador M3 simulado y un stub temporal de preferencias
M2. Recorre RabbitMQ real, el Inbox de RF8.6, la notificación y Outbox de
RF8.1, el relay y la entrega PUSH sandbox de RF8.7. Repite `messageId`, envía
un evento inválido y verifica que un evento posterior se entregue. No acredita
que el M3 desplegado emita el `userId` canónico de M1 ni un PUSH externo real.

Desde `modulo-8/`, con `.env` configurado:

```powershell
docker compose -f compose.yaml -f tests/e2e/compose-m3-document.yaml up -d --build m8-app m2-preferences-sandbox
$composeConfig = docker compose -f compose.yaml -f tests/e2e/compose-m3-document.yaml config --format json | ConvertFrom-Json
$env:RABBITMQ_URL = $composeConfig.services.'m8-app'.environment.RABBITMQ_URL.Replace('@rabbitmq:', '@localhost:')
node tests/e2e/m3-document-flow.mjs
Remove-Item Env:RABBITMQ_URL
```

Si el volumen PostgreSQL fue creado antes de integrar M3/RF8.7, aplicar una
vez los scripts idempotentes de permisos y de la columna `trip_id` nullable:

```powershell
docker compose exec -T postgres sh /docker-entrypoint-initdb.d/03-notifications.sh
docker compose exec -T postgres sh /docker-entrypoint-initdb.d/04-notification-delivery.sh
```

Para volver a la configuración normal de M8 después de la prueba:

```powershell
docker compose up -d m8-app
docker compose -f compose.yaml -f tests/e2e/compose-m3-document.yaml stop m2-preferences-sandbox
```

## Ejecutar la imagen publicada

La imagen integrada requiere PostgreSQL, Redis, RabbitMQ y los sandboxes del
Compose. No debe ejecutarse sola con `docker run` para demostrar el sistema.

```powershell
docker image ls juanmainval/m8-notificaciones-qr
docker pull juanmainval/m8-notificaciones-qr:2.0.0
$env:M8_IMAGE = "juanmainval/m8-notificaciones-qr:2.0.0"
docker compose --env-file .env up -d --no-build
Invoke-WebRequest http://localhost:3000/health/ready -UseBasicParsing
```

Para volver a la imagen local, cerrar la consola o ejecutar:

```powershell
Remove-Item Env:M8_IMAGE -ErrorAction SilentlyContinue
```

## Apagado

```powershell
docker compose --env-file .env down --remove-orphans
```

No usar `down -v` salvo que se quiera eliminar explícitamente el volumen local
de PostgreSQL y sus datos de desarrollo.
