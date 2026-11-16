# Módulo 8 — Notificaciones, Documentos y Soporte

Este directorio reúne el backend del Módulo 8. RF8.1 a RF8.7 se ejecutan en
una única aplicación HTTP (`m8-app`) y conservan las
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

Cada RF tiene su propia responsabilidad dentro de la misma aplicación. Sus
contratos y guías se encuentran en los índices enlazados más abajo.

Cada RF conserva ownership lógico de sus datos. M8 no consulta directamente
bases de datos, Redis ni tablas de otros módulos: toda integración externa se
realiza por HTTP/OpenAPI documentado o por eventos RabbitMQ acordados.

## Requisitos
- Node.js 24;
- pnpm 10.33.0;
- Docker Desktop con Docker Compose.

## Dónde está cada parte

M8 es una sola aplicación backend. `src/` la inicia y monta los paquetes de
`services/`: notificaciones (RF8.1), QR (RF8.2), comprobantes y reenvío (RF8.3
y RF8.4), soporte (RF8.5), mensajería compartida (RF8.6) y entrega (RF8.7).
`infra/` contiene la infraestructura **local de M8** y los simuladores usados
en las pruebas; no es la infraestructura definitiva de los otros módulos.

Los contratos se encuentran desde un único [índice por RF](contracts/README.md):
HTTP en `openapi/` y RabbitMQ en `contracts/events/`. Las guías y decisiones
están en el [índice de documentación](docs/README.md). Las versiones anteriores
se pueden consultar en el historial Git. `dist/` y `node_modules/` son generados.

M8 todavía no contiene un frontend de usuario. Sus pantallas se incorporarán
al frontend común del proyecto; `/docs` es documentación interactiva de la API.

## Ejecución local desde el código fuente
Abrir PowerShell dentro de `modulo-8` y crear el archivo de configuración local
una sola vez:

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
pnpm install --frozen-lockfile
pnpm run build
```

Antes de iniciar Compose, reemplazar **todos** los valores `replace-with-*` del
`.env` local: claves de RabbitMQ, PostgreSQL, QR, M1 y M2. Configurar las dos
URL de RabbitMQ con el mismo usuario y contraseña definidos para el broker.
Si ya existe un volumen PostgreSQL, conservar las contraseñas con que se crearon
sus roles. M6 deberá enviar `QR_INTERNAL_API_KEY` en `x-api-key` al llamar a
`POST /qr` y `POST /qr/validate`. No publicar claves en Git ni en capturas.
Para reintentar una validación, M6 debe conservar el mismo UUID en el header
`Idempotency-Key`; una solicitud distinta usa un UUID nuevo.

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

## Imagen y demostración

Una imagen publicada anteriormente es `juanmainval/m8-notificaciones-qr:2.0.1`. Necesita
la misma infraestructura compartida, por lo que debe levantarse con Compose y
no mediante un `docker run` aislado.
Esa etiqueta corresponde a una versión anterior: para medir o demostrar
los cambios de esta rama, construir la imagen local con `docker compose
--env-file .env up -d --build --wait`. La imagen resultante se llama
`modulo-8-m8-app:local` por defecto y el servicio Compose es `m8-app`.

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

### Pruebas de carga de M8

Cada integrante puede clonar esta rama, crear su propio `.env` local y levantar
el Compose anterior. M8 escucha en `http://localhost:3000` de **esa PC**; la
imagen de M8 sola no incluye PostgreSQL, Redis ni RabbitMQ. Para comprobar el
entorno antes de cargarlo:

```powershell
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:3000/health/ready
```

M8 expone `GET /metrics`. La [guía de observabilidad](docs/guia-observabilidad-y-comandos.md)
explica cómo ejecutar el smoke HTTP de k6 y habilitar Grafana Alloy para enviar
las métricas a Grafana Cloud. El smoke no sustituye las pruebas de RabbitMQ ni
una prueba de carga con varios usuarios virtuales.

## Calidad e infraestructura

### Explorar PostgreSQL como tablas

Prisma Studio es una interfaz visual de desarrollo para ver y filtrar filas de
PostgreSQL. Se conecta a la base M8 existente y reconoce sus tablas; no usamos
Prisma ORM en la aplicación ni cambiamos las migraciones SQL. Corre en la PC,
fuera del contenedor M8. Necesita que el servicio PostgreSQL de Compose esté
levantado y que `.env` tenga `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB` y `POSTGRES_HOST_PORT`.

Desde `modulo-8/`:

```powershell
docker compose --env-file .env up -d postgres
pnpm install --frozen-lockfile
pnpm run db:studio
```

Abrí la dirección local que imprime Studio. Si el puerto habitual está ocupado,
puede elegir otro, como `http://localhost:51212`. Si aparece
**Could not load schema metadata**, comprobá primero que Docker Desktop esté
iniciado y que `docker compose --env-file .env ps postgres` muestre PostgreSQL
en ejecución; después pulsá **Retry** en Studio. En el panel de tablas vas a
encontrar los esquemas `messaging`, `notification_delivery`, `notifications`,
`receipts` y `support`.
Por ejemplo, abrí `receipts.receipts` para ver los comprobantes. Para detener
Studio, presioná `Ctrl+C` en la terminal donde se inició. La configuración
`infra/db-ui/prisma.config.ts` construye la conexión a partir del `.env` local;
no se guarda una URL con contraseña en Git. La interfaz permite editar filas,
por lo que corresponde usarla sólo con datos de desarrollo.

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
[guía de soporte](docs/rf8.5/generaciontickets.md).

Antes de preparar commits, ejecutar `pnpm run check:secrets`. La plantilla
`.env.example` sólo contiene marcadores para las credenciales; el `.env` real
permanece ignorado por Git. El CI genera sus propias claves temporales y repite
esa comprobación.

## Apagado

```powershell
docker compose --env-file .env down --remove-orphans
```

Este comando elimina los contenedores y la red del entorno, pero conserva las
imágenes descargadas y el volumen de desarrollo de PostgreSQL.
