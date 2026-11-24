# Módulo 8 — Notificaciones, QR, comprobantes y soporte

M8 es el servicio de comunicaciones de la plataforma de movilidad urbana. Tiene **una aplicación Node.js y una imagen Docker**. PostgreSQL guarda los datos duraderos, Redis mantiene los QR temporales y RabbitMQ transporta eventos. M8 no crea viajes ni cambia sus estados: eso le corresponde a M6.

## Requerimientos

- **RF8.1 — Notificaciones:** convierte hechos de viaje y documentos en avisos persistidos para el usuario correcto, evita duplicados y solicita la entrega a RF8.7.
- **RF8.2 — QR:** genera QR temporales para un `tripId`, con vencimiento y consumo atómico de un solo uso en Redis. M6 decide si inicia el viaje.
- **RF8.3 — Comprobantes:** consulta el pago de M7 por REST, emite un comprobante por viaje, guarda el PDF y sus datos, y publica `ReceiptIssued` mediante Outbox.
- **RF8.4 — Reenvío:** solicita otra entrega del comprobante existente y crea un enlace temporal; reutiliza el PDF.
- **RF8.5 — Soporte:** crea tickets asociados a viajes, conserva estados e historial y permite a un operador confirmar penalizaciones de clientes que consulta M2.
- **RF8.6 — Mensajería:** conecta RabbitMQ, valida eventos, deduplica con Inbox, confirma con ACK tras procesar y aplica retry y DLQ. Consume `documento.registrado` desde `m3.eventos` y los eventos de viaje acordados desde `mobility.events`.
- **RF8.7 — Entrega PUSH:** administra tokens de dispositivos, solicitudes, intentos y resultados. Un intento registrado no demuestra por sí solo una entrega real en un teléfono.

Los destinatarios usan el `userId` **numérico** de M1. M8 no lee tablas ni Redis de otros módulos. Las integraciones externas son por REST o RabbitMQ. El [índice de contratos](contracts/README.md) enlaza el [OpenAPI integrado](openapi/m8-openapi.yaml) y el [catálogo de eventos](contracts/events/catalogo-eventos-v1.md).

M8 consume `ride.requested`, `driver.offer.accepted` y `ride_request.cancelled`
de M5 en `m8.notifications.m5-events`. La aceptación crea avisos para cliente y
conductor; la cancelación previa al viaje avisa sólo al cliente. El
[acuerdo M5 → M8](contracts/events/m5-m8-notificaciones.md) detalla destinatarios,
correlación y el límite de entrega cuando RabbitMQ está caído antes de publicar.
El aviso al cliente puede incluir el nombre y el vehículo del conductor. M8
consulta el nombre a M1 por `driverUserId` con la clave compartida
`M1_INTERNAL_API_KEY` y el vehículo activo a M3 mediante
`M3_VEHICLES_BASE_URL`. Si una consulta falla, M8 genera ambos avisos con los
datos disponibles.

## Organización

- `src/`: servidor, rutas y arranque único.
- `services/`: lógica interna por RF; `shared/` reúne mensajería común.
- `openapi/` y `contracts/events/`: contratos HTTP y RabbitMQ.
- `infra/`: PostgreSQL local, observabilidad y simuladores de otros servicios para pruebas.
- `tests/`: integración, E2E, resiliencia y carga.
- `frontend/m8.js`: vistas reutilizables de comprobantes, soporte y dispositivos. `frontend/preview/` contiene solamente el menú y acceso manual con JWT de la demo; **no se incorpora esa navegación al frontend común**.
- `docs/`: [guías](docs/README.md), [RUNBOOK](docs/RUNBOOK.md) y [escenarios de observabilidad](docs/matriz-escenarios-observabilidad.md).

`dist/` y `node_modules/` son generados. Prisma Studio sólo inspecciona PostgreSQL: la aplicación usa SQL y migraciones propias, no Prisma ORM.

## Requisitos y configuración

Para desarrollar: **Node.js 24**, **pnpm 10.33.0** y Docker Desktop con Docker Compose. Ejecutá los comandos desde `modulo8/` en PowerShell.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm install --frozen-lockfile
```

Si `.env` ya existe, no lo sobrescribas. Reemplazá los marcadores `replace-with-*` por valores privados: contraseñas de PostgreSQL y RabbitMQ y claves internas de QR, M1 y M2. `M8_RABBITMQ_URL` debe usar el usuario y contraseña configurados para el broker. **No subas `.env`, claves ni capturas de sus valores.** `.env.example` contiene sólo nombres y marcadores.

El Compose local usa simuladores de M1, M2 y M7. En la integración común sus URL se reemplazan por las de los servicios reales. Las conexiones se configuran por variables de entorno.

## Despliegue local con Docker

```powershell
docker compose --env-file .env up -d --build --wait
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:8000/health/ready
```

Compose construye `modulo-8-m8-app:local` e inicia `m8-app` y sus dependencias. El puerto HTTP del host es `8000` por defecto; se cambia con `M8_HOST_PORT`. La URL interna de otros contenedores es `http://m8-app:3000`. El Compose común publica M8 en `18000`; los puertos internos de contenedores distintos no chocan.

- `/health/live`: confirma que el proceso responde.
- `/health/ready` y `/health`: indican si M8 puede atender con sus dependencias.
- `/docs`: documentación interactiva de la API.
- `/openapi.yaml`: contrato HTTP integrado.
- `/metrics`: métricas que lee Grafana Alloy.

Tras cambiar código, reconstruí la aplicación con `docker compose --env-file .env up -d --build m8-app`. Para diagnosticar: `docker compose --env-file .env ps` y `docker compose --env-file .env logs --tail=100 m8-app`.

Para detener sin borrar datos: `docker compose --env-file .env down --remove-orphans`. **No uses `down -v` para una demostración:** elimina el volumen PostgreSQL.

## PostgreSQL, Redis y RabbitMQ

La base local se llama `m8` por defecto. Sus esquemas separan `messaging`, `notifications`, `notification_delivery`, `receipts` y `support`. PostgreSQL es la fuente de verdad de avisos, intentos, comprobantes y tickets. Redis guarda QR que vencen; RabbitMQ transporta mensajes.

Para inspeccionar tablas sin cambiar la aplicación:

```powershell
docker compose --env-file .env up -d postgres
pnpm run db:studio
```

Prisma Studio imprime una URL local; elegí el esquema arriba. La interfaz permite editar filas, así que usala sólo para desarrollo. RabbitMQ Management está en `http://localhost:15672` y usa las credenciales privadas de `.env`.

El evento externo de M3 llega a `m8.notificaciones.documento-registrado`. M8 mantiene `mobility.events` y su DLX para mensajería interna. Los contratos exactos están en el [catálogo](contracts/events/catalogo-eventos-v1.md). RF8.6 no recibe `documento.registrado` por una API REST.

## Pruebas

```powershell
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm run check:secrets
```

`test` prepara dependencias locales, prueba paquetes y verifica el arranque integrado. `test:e2e` usa Compose y provoca fallas controladas; ejecutalo sin otras pruebas o demos simultáneas. Los tests pueden insertar datos de ejemplo. También existen `test:qr`, `test:receipts`, `test:support`, `test:delivery`, `test:notifications` y `test:infrastructure`.

`pnpm run smoke:http` recorre las rutas HTTP. Para RF8.1/RF8.6, que procesan RabbitMQ, `pnpm run scenario:m3` permite revisar Inbox, aviso e intento de entrega. La [guía de escenarios](docs/matriz-escenarios-observabilidad.md) indica qué probar por RF.

## Carga y Grafana Cloud

M8 expone métricas en `/metrics`. El perfil opcional `observability` inicia Grafana Alloy y envía las métricas a Grafana Cloud cuando las tres variables `GRAFANA_CLOUD_*` están configuradas de forma privada en `.env`:

```powershell
docker compose --env-file .env --profile observability up -d alloy
pnpm run smoke:http
```

Los scripts k6 viven en `tests/stress/`. `pnpm run load:ramp45` incrementa usuarios durante unos 45 segundos; `pnpm run load:capacity` busca una zona de saturación. **Los resultados describen el Compose local con simuladores**, no certifican la capacidad del sistema integrado. El [paso a paso](docs/guia-observabilidad-y-comandos.md) explica paneles, límites y escenarios.

## Frontend e integración común

Para levantar M8 desde el `docker-compose.yml` de la raíz y probar el QR real
con M6, ver [M8 en el Compose común](INTEGRACION_COMPOSE.md). Esa configuración
comparte Redis y RabbitMQ, conserva PostgreSQL propio y publica M8 en el puerto
18000 del host. El Compose aislado de este README se mantiene para las pruebas
locales con simuladores.

Las vistas que M8 puede aportar hoy son comprobantes (RF8.3/8.4), soporte (RF8.5) y dispositivos PUSH (RF8.7). El frontend común debe aportar navegación, sesión de M1, autorización y estilo compartido. El código de las vistas está en `frontend/m8.js`; `frontend/preview/` es sólo una herramienta local. RF8.2 se muestra en el viaje de M6, RF8.6 no necesita pantalla y RF8.1 requiere un endpoint seguro de consulta antes de prometer una bandeja de avisos. Ver la [guía del frontend](frontend/README.md).

Queda por acreditar en la rama común el flujo con **M1/M2/M3/M5/M6/M7 reales**, infraestructura compartida, bases separadas y un proveedor PUSH real con token válido. Hay que verificar los destinatarios numéricos de M1, las preferencias reales de M2, las rutas QR con M6 sin delegar el cambio de estado, el pago real de M7 y que repetir un `messageId` no duplique aviso ni entrega. Las pruebas locales con simuladores no reemplazan esa prueba conjunta.
