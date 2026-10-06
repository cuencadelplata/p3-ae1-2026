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
placeholders exclusivos de desarrollo.

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
