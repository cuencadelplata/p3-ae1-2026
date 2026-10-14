# Módulo 8 — Notificaciones, Documentos y Soporte

La entrega actual es la integracion completa del Modulo 8 para el AE2. El módulo
reúne RF8.1 a RF8.7 en una única aplicación HTTP (`m8-app`) y conserva las
responsabilidades de cada requerimiento separadas internamente. PostgreSQL,
Redis y RabbitMQ se ejecutan como infraestructura compartida del módulo.

M8 no administra el ciclo de vida del viaje: no crea viajes, no los inicia ni
modifica el estado `EN_CURSO`; esas decisiones pertenecen a M6.

## Qué resuelve M8

- **RF8.1 — Notificaciones:** interpreta hechos notificables, genera y
  persiste la notificación lógica e impide duplicados de negocio.
- **RF8.2 — QR:** genera QR temporales con token opaco, TTL y consumo atómico
  de un solo uso.
- **RF8.3 — Comprobantes:** emite, guarda y permite consultar comprobantes PDF.
- **RF8.4 — Reenvío:** vuelve a solicitar el envío de un comprobante sin
  regenerar su PDF.
- **RF8.5 — Soporte:** crea tickets asociados a un viaje, conserva historial y
  controla idempotencia y concurrencia.
- **RF8.6 — Mensajería:** administra el transporte RabbitMQ, envelope, Inbox,
  reintentos, DLQ y adaptadores de eventos.
- **RF8.7 — Entrega:** administra dispositivos, intentos e idempotencia de la
  entrega PUSH.

Los responsables trabajan por requerimiento para mantener el código
desacoplado: Juan Martín Invaldi (RF8.1), Bautista Goya (RF8.2), Juan
Gualtieri (RF8.3), Lucas Cremaschi (RF8.4), Damián Caminos (RF8.6) y Santiago
Meza (RF8.7). RF8.5 se integra con el mismo criterio de separación de
responsabilidades. La integración se realizó mediante contratos compartidos,
pruebas automatizadas, Compose e infraestructura común, sin transformar los RF
en aplicaciones HTTP independientes.

Cada RF conserva ownership lógico de sus datos. M8 no consulta directamente
bases de datos, Redis ni tablas de otros módulos: toda integración externa se
realiza por HTTP/OpenAPI documentado o por eventos RabbitMQ acordados.

## Requisitos
- Node.js 24;
- pnpm 10.33.0;
- Docker Desktop con Docker Compose.

## Ejecución local desde el código fuente
Abrir PowerShell dentro de `modulo-8` y crear el archivo de configuración local
una sola vez:

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
pnpm install --frozen-lockfile
pnpm run build
```

Ejecutar la suite principal:

```powershell
pnpm run test
```

El script prepara las dependencias de prueba necesarias. Para levantar la
topología completa y la aplicación integrada:

```powershell
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
Invoke-WebRequest http://localhost:3000/health/live -UseBasicParsing
```

La aplicación queda publicada en `http://localhost:3000` por defecto. El
puerto se configura con `M8_HOST_PORT`.

## Rutas de verificación

- `GET /health/live`: confirma que el proceso Node sigue vivo.
- `GET /health/ready` y `GET /health`: muestran la disponibilidad agregada de
  módulos y dependencias. Devuelven `503` cuando alguna dependencia crítica no
  está disponible, aunque el proceso continúe vivo.
- `GET /openapi.yaml`: entrega el contrato OpenAPI integrado en YAML.
- `GET /docs`: muestra Scalar, la documentación navegable e interactiva.

`openapi: 3.0.3` indica la versión de la especificación OpenAPI utilizada;
`info.version: 2.0.1` identifica la versión actual del contrato integrado.

## Imagen publicada y demostración

La imagen integrada AE2 es `juanmainval/m8-notificaciones-qr:2.0.1`. Necesita
la misma infraestructura compartida, por lo que debe levantarse con Compose y
no mediante un `docker run` aislado.

```powershell
docker image ls juanmainval/m8-notificaciones-qr
docker pull juanmainval/m8-notificaciones-qr:2.0.1
$env:M8_IMAGE = "juanmainval/m8-notificaciones-qr:2.0.1"
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:3000/health/ready | ConvertTo-Json -Depth 8
```

Para volver a usar la imagen construida localmente:

```powershell
Remove-Item Env:M8_IMAGE -ErrorAction SilentlyContinue
```

## Calidad e infraestructura

Con el entorno levantado se pueden ejecutar las verificaciones de demostración:

```powershell
pnpm run test:infrastructure
pnpm run test:e2e
pnpm run test:resiliencia
```

`test:infrastructure` verifica PostgreSQL y los schemas lógicos de M8, Redis,
RabbitMQ, el exchange `mobility.events` y su DLX. `test:e2e` comprueba los
flujos HTTP integrados y luego la recuperación frente a caídas controladas de
dependencias. Estas pruebas pueden demorar varios minutos porque detienen y
restauran infraestructura de forma controlada; no deben ejecutarse en paralelo
con otra demostración manual.

La guía paso a paso de demostración está en [`../test.md`](../test.md), el
procedimiento operativo ampliado en [docs/RUNBOOK.md](docs/RUNBOOK.md) y una
demo manual específica de Support en
[docs/rf85_generaciontickets.md](docs/rf85_generaciontickets.md).

Las variables `M1_JWT_SECRET` y `M2_INTERNAL_API_KEY` de `.env.example` son
placeholders exclusivos de desarrollo. En un entorno real se inyectan
externamente y nunca se versionan secretos.

## Apagado

```powershell
docker compose --env-file .env down --remove-orphans
```

Este comando elimina los contenedores y la red del entorno, pero conserva las
imágenes descargadas y el volumen de desarrollo de PostgreSQL.

## Identificación de entrega

- Rama integrada: `AE2/notificaciones-qr-receipts-support`.
- Archivo comprimido: `AE2-M08-ApellidoNombre.zip`.
- Informe: `Informe-AE2-M08-Apellido.docx`.
