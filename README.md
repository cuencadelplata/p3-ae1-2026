# p3-ae1-2026
Paradigmas 3 AE1 2026

# M3 — Conductores y Vehículos (m3-drivers)

Módulo M3 de UCP móvil: gestión de vehículos (**RF-3.2**) y documentación
asociada (**RF-3.4**) de los conductores. Parte de la entrega AE1
(Paradigmas y Lenguajes de Programación III — ISI17PL324) y de su
profundización en AE2 (Eje 3 — arquitectura y comunicación entre
aplicaciones).

## Stack

- Node.js + TypeScript (Express 5)
- Supabase (PostgreSQL) como persistencia
- Docker / Docker Compose para contenerización
- Jest (pruebas unitarias) + Playwright (pruebas End-to-End)
- Redis 7 (redis:7-alpine), como caché para idempotencia de pedidos
- RabbitMQ 3 (rabbitmq:3-management-alpine), para mensajería asíncrona entre operaciones del módulo

## Requisitos previos

- Docker y Docker Compose (para correr contenerizado), o
- Node.js 22+ y npm (para correr en local sin Docker)
- Una instancia de Supabase con las tablas `vehiculos` y `documentos` creadas

## Variables de entorno

Crear un archivo `.env` en la raíz del módulo (`m3-vehiculos/`) con:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
PORT=8083
```

- `REDIS_URL`: URL de conexión a Redis. Local (`npm run dev`): `redis://localhost:6379`. En Docker (`docker compose`): `redis://redis:6379` (nombre del servicio dentro de la red de compose).
- `RABBITMQ_URL`: URL de conexión a RabbitMQ. Local: `amqp://localhost:5672`. En Docker: `amqp://rabbitmq:5672` (nombre del servicio dentro de la red de compose).

## Ejecución con Docker (recomendado)

```bash
docker compose up --build -d
```

Verificar que el contenedor esté sano:

```bash
docker compose ps
curl http://localhost:8083/health
```

Panel de administración de RabbitMQ (colas, exchanges, mensajes en vivo): `http://localhost:15672` (usuario/contraseña por defecto `guest`/`guest`).

Detener y limpiar:

```bash
docker compose down
```

### Imagen publicada

La imagen también está disponible en Docker Hub, sin necesidad de build local:

```bash
docker pull vicbladilo/m3-vehiculos:1.1
docker run --env-file .env -p 8083:8083 vicbladilo/m3-vehiculos:1.1
```

- Repositorio: https://hub.docker.com/r/vicbladilo/m3-vehiculos
- Tags publicados: `1.0`, `1.1` (no depende de `latest`)

## Ejecución local (sin Docker)

```bash
npm install
npm run dev
```

El servidor queda escuchando en `http://localhost:8083`.

## Documentación de la API

La especificación OpenAPI está en [`openapi.yaml`](./openapi.yaml). Para
visualizarla de forma interactiva, pegar el contenido en
https://editor.swagger.io, o correr localmente:

```bash
npx @scalar/cli document serve openapi.yaml
```

## Pruebas

**Unitarias (Jest)** — prueban la lógica de negocio del service en
aislamiento (mockeando el repository, sin tocar Supabase real):

```bash
npm test
```

**End-to-End (Playwright)** — prueban los endpoints reales contra el
servidor corriendo (Playwright lo levanta solo si hace falta):

```bash
npx playwright test
```

Cobertura actual: 25 tests E2E (10 de vehículos, 12 de documentos, 2 de idempotencia) +
pruebas unitarias del service de vehículos, todos en verde.

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/drivers/:driverId/vehicles` | Registrar vehículo (RF-3.2) |
| GET | `/api/v1/drivers/:driverId/vehicles` | Listar vehículos del conductor |
| GET | `/api/v1/drivers/:driverId/vehicles/:vehicleId` | Obtener un vehículo |
| PATCH | `/api/v1/drivers/:driverId/vehicles/:vehicleId/activar` | Activar vehículo |
| POST | `/api/v1/drivers/:driverId/documents` | Registrar documentación (RF-3.4) |
| GET | `/api/v1/drivers/:driverId/documents` | Listar documentos del conductor |
| GET | `/api/v1/drivers/:driverId/documents/:documentId` | Obtener un documento |

Ver `openapi.yaml` para el detalle completo de parámetros, cuerpos de
solicitud y respuestas de error.

## Mensajería asíncrona (RabbitMQ)

El módulo publica eventos de dominio a un exchange `topic` durable llamado
`m3.eventos`. Cada operación de creación dispara su propio evento, consumido
de forma asíncrona por un listener dedicado:

| Evento (routing key) | Se publica cuando... | Cola consumidora | Qué hace el consumidor |
|---|---|---|---|
| `vehiculo.creado` | se registra un vehículo nuevo (RF-3.2) | `notificaciones.vehiculo.creado` | Simula la notificación al conductor de que su vehículo quedó registrado |
| `documento.subido` | se registra un documento nuevo (RF-3.4) | `validacion.documento.subido` | Simula el disparo de un proceso de validación del documento subido |

La publicación de eventos nunca bloquea ni revierte la operación principal:
si RabbitMQ no responde, el error se loguea pero la creación del vehículo o
documento se completa igual (mismo criterio que la idempotencia con Redis:
un servicio de mensajería caído no puede tumbar la funcionalidad core).

## Propiedad de datos (RNF-04)

M3 es el único módulo con acceso de lectura/escritura directo a las tablas
`vehiculos` y `documentos` en Supabase. Ningún otro módulo del sistema lee
estas tablas directamente: si otro módulo (por ejemplo M6 — Viajes) necesita
datos de vehículos o documentación de un conductor, debe pedirlos a través
de los endpoints HTTP expuestos acá (`GET /api/v1/drivers/:driverId/vehicles`,
etc.) o, para flujos asíncronos, suscribirse a los eventos publicados en
`m3.eventos`. Esto mantiene cada módulo dueño exclusivo de su propio esquema
de datos, sin acoplamiento a nivel de base de datos entre módulos.

## Caso de concurrencia documentado (RNF-09)

Escenario: dos conductores intentan registrar un vehículo con la misma
patente al mismo tiempo. La unicidad se garantiza con una restricción
`UNIQUE` sobre la columna `patente` en la base de datos (no con un chequeo
previo en la aplicación, que tendría una ventana de carrera entre el check y
el insert). Ante dos inserts concurrentes con la misma patente, Postgres los
serializa: uno se inserta con éxito (`201`), el otro recibe el error
`23505` (unique_violation) que el repository traduce a un `409` ("Ya existe
un vehículo con esa patente"). Verificado con dos requests lanzados en
paralelo real (no secuenciales).

## Decisiones técnicas y limitaciones conocidas

- Cada módulo (M3 incluido) es un proyecto Node autocontenido, con su
  propio `package.json`/`node_modules`, alineado con el requisito de
  arquitectura modular por servicios (no monolito).
- Arquitectura en capas: `routes` → `service` (reglas de negocio,
  errores `AppError` con status HTTP) → `repository` (única capa que
  conoce el esquema real de Supabase, snake_case) → `model`/`dto`.
- Un vehículo inexistente (`vehicleId`) devuelve `404`; datos de entrada
  inválidos devuelven `400`; una patente duplicada devuelve `409`.
- `LICENCIA_CONDUCIR` nunca lleva `vehicleId`; `SEGURO_VEHICULO` y
  `CEDULA_VEHICULO` lo requieren siempre (validado tanto en la app como
  con un constraint en la base).
- No implementa autenticación/autorización (fuera del alcance de AE1
  para este módulo; ver M1 — Identidad y Acceso).
- Se agregó idempotencia en los endpoints POST /vehicles y POST /documents
  usando Redis. El cliente puede mandar un header `Idempotency-Key`; si
  reintenta el mismo pedido con la misma key, el servidor devuelve la
  respuesta ya guardada en vez de procesar el pedido de nuevo (evita
  duplicados por reintentos de red). Las respuestas se cachean por 24hs, y
  solo si el pedido original tuvo éxito (2xx) — un error no se cachea, para
  no bloquear un reintento legítimo. Si no se manda el header, el
  comportamiento es el de siempre (sin idempotencia).
- Redis corre con persistencia (volumen `redis_data`), preparado para
  cuando se unifique con el servicio de Redis del otro subgrupo de M3
  (rama `M3-Conductor`), que usa Redis como almacenamiento principal de
  conductores/valoraciones.

## AE2 — Entrega individual

Esta rama (`ae2/victoria-bladilo`) parte del commit `679c3f6` (tag
`ae1-m3-base`), último commit de `m3-vehiculos` anterior al deadline
original de AE1, usado como base ante la ausencia de un tag oficial. El trabajo de AE2 construido sobre
esa base (Redis con persistencia, RabbitMQ con 2 flujos asíncronos, caso de
concurrencia documentado) corresponde a los mismos RF de AE1: RF-3.2
(vehículos) y RF-3.4 (documentación).