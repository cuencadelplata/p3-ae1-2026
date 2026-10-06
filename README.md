# Módulo 8 — Notificaciones, Documentos y Soporte

Este directorio contiene la implementación integrada de M8 para AE2. La
aplicación reúne internamente RF8.1 a RF8.7 en un único proceso HTTP, sin
mezclar sus responsabilidades de negocio.

M8 no administra el ciclo de vida del viaje: en particular, no inicia viajes
ni modifica el estado `EN_CURSO`, que pertenece a M6.

## Alcance

- RF8.1: notificaciones de viaje e idempotencia de negocio;
- RF8.2: QR temporal, TTL y consumo de un solo uso;
- RF8.3 y RF8.4: comprobantes, PDF y reenvío;
- RF8.5: tickets de soporte;
- RF8.6: mensajería RabbitMQ, Inbox, retry y DLQ;
- RF8.7: entrega PUSH, dispositivos, intentos e idempotencia de delivery.

PostgreSQL, Redis y RabbitMQ son infraestructura compartida dentro de M8. Cada
RF conserva ownership lógico de sus datos. M8 no accede directamente a datos
de infraestructura de otros módulos.

## Requisitos

- Node.js 24;
- pnpm 10.33.0;
- Docker Desktop con Docker Compose.

## Ejecución local

Primero crear una configuración local a partir del ejemplo:

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

Luego levantar la topología completa:

```powershell
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
```

La única aplicación HTTP de M8 queda publicada en el puerto configurado por
`M8_HOST_PORT` (3000 por defecto):

- `GET /health/live`: vitalidad del proceso;
- `GET /health/ready` y `GET /health`: disponibilidad agregada;
- `GET /openapi.yaml`: índice OpenAPI integrado;
- `GET /docs`: documentación interactiva Scalar;
- rutas funcionales de Notifications, QR, Receipts, Support y Delivery.

Para detener el entorno local:

```powershell
docker compose --env-file .env down --remove-orphans
```

## Imagen publicada y demostración

La versión integrada AE2 se publicará como `juanmainval/m8-notificaciones-qr:2.0.0`.
La imagen necesita la misma infraestructura compartida, por lo que se ejecuta con
Compose, no con un `docker run` aislado.

```powershell
docker image ls juanmainval/m8-notificaciones-qr
docker pull juanmainval/m8-notificaciones-qr:2.0.0
$env:M8_IMAGE = "juanmainval/m8-notificaciones-qr:2.0.0"
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
Invoke-WebRequest http://localhost:3000/health/ready -UseBasicParsing
```

Luego se pueden abrir `http://localhost:3000/docs` para Scalar y
`http://localhost:3000/openapi.yaml` para el contrato. La demostración HTTP
integrada se verifica con `pnpm run test:e2e` y la infraestructura con
`pnpm run test:infrastructure`.

Las variables `M1_JWT_SECRET` y `M2_INTERNAL_API_KEY` del ejemplo sirven solo
para desarrollo local. En cualquier entorno real deben inyectarse externamente
sin versionar secretos.

## Calidad

La verificación completa se ejecuta con:

```powershell
pnpm run build
pnpm run test
pnpm run test:e2e
```

El detalle operativo y de recuperación está en [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Identificación de entrega

- Rama integrada final prevista: `AE2/notificaciones-qr-receipts-support`.
- Archivo comprimido de entrega: `AE2-M08-ApellidoNombre.zip`.
- Informe: `Informe-AE2-M08-Apellido.docx`.
