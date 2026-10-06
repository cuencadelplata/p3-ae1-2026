# p3-ae1-2026 — Módulo 3: Conductores, Valoraciones y Vehículos

Paradigmas y Lenguajes de Programación III (AE1/AE2 - 2026).

El Módulo 3 está dividido en dos subproyectos Node autocontenidos, cada uno con su propio `package.json`, Docker Compose y pruebas:

| Carpeta | Alcance | Puerto API |
|---|---|---|
| [`M3-Conductor/`](#m3-conductor--conductores-y-valoraciones) | Conductores (RF 3.1, RF 3.3) y valoraciones | `5000` (Docker) / `3000` (local) |
| [`m3-vehiculos/`](#m3-vehiculos--vehículos-y-documentación) | Vehículos (RF-3.2) y documentación (RF-3.4) | `8083` |

> **Nota:** los dos `docker compose` publican Redis (`6379`) y RabbitMQ (`5672` / `15672`) en los mismos puertos del host, así que no se pueden levantar a la vez sin unificar esos servicios o cambiar los puertos.

---

## M3-Conductor — Conductores y Valoraciones

Los comandos de esta sección se ejecutan dentro de `M3-Conductor`.

---

### Puesta en marcha

#### Opción 1: Con Docker Compose (recomendada)

Levanta Redis, RabbitMQ, la API en Node.js, el consumidor de eventos de ejemplo y el frontend en Nginx:

```bash
cd M3-Conductor
docker compose up -d --build
```

- **Frontend (Test Runner y Swagger UI):** [http://localhost:4000](http://localhost:4000)
- **API por el proxy del frontend:** [http://localhost:4000/api](http://localhost:4000/api)
- **API directa:** [http://localhost:5000/api](http://localhost:5000/api)
- **Health check:** [http://localhost:5000/health](http://localhost:5000/health)
- **Redis:** `localhost:6379`
- **RabbitMQ (AMQP):** `localhost:5672`
- **RabbitMQ Management:** [http://localhost:15672](http://localhost:15672) (`admin` / `admin123`)
- **Consumidor de ejemplo:** `docker compose logs -f consumer`

#### Opción 2: Local con Node.js

Redis y RabbitMQ tienen que estar corriendo. Se pueden levantar solo esos dos servicios con Docker:

```bash
cd M3-Conductor
docker compose up -d redis rabbitmq
npm install
npm start
```

- **Frontend y API:** [http://localhost:3000](http://localhost:3000)
- **Health check:** [http://localhost:3000/health](http://localhost:3000/health)
- **Consumidor de ejemplo:** `npm run consumer` (requiere RabbitMQ en `RABBITMQ_URL`)

En el panel, cambiá **Base URL** a `http://localhost:3000/api`. El valor por defecto (`http://localhost:4000/api`) corresponde a Docker.

---

### 📨 Mensajería asíncrona con RabbitMQ (RNF-07)

M3 publica eventos en el exchange topic `m3.conductores.events` cada vez que cambia el estado de un conductor:

| Evento | Routing key | Se emite cuando |
|---|---|---|
| `DriverAvailabilityUpdated` | `driver.availability.updated` | `PUT /api/conductores/:id/disponible` cambia la disponibilidad (RF 3.3) |
| `DriverStatusChanged` | `driver.status.changed` | `PUT /api/conductores/:id/habilitado` cambia la habilitación (RF 3.1) |

- **Producer:** `M3-Conductor/src/events/eventPublisher.js` (publisher confirms, mensajes persistentes).
- **Consumidor de ejemplo:** `M3-Conductor/src/consumers/driverEventsConsumer.js` (cola propia, `ack` manual).
- **Contrato completo de los eventos:** [`M3-Conductor/docs/EVENTOS.md`](M3-Conductor/docs/EVENTOS.md).

---

### Probar con el frontend

El panel está en `M3-Conductor/public/index.html`.

1. Abrí [http://localhost:4000](http://localhost:4000) si usás Docker, o [http://localhost:3000](http://localhost:3000) si usás `npm start`.
2. Confirmá la **Base URL** (`http://localhost:4000/api` o `http://localhost:3000/api`).
3. Tocá el botón de refresco junto a la URL. El indicador pasa a verde cuando la API responde.
4. En **Test Runner**, elegí un endpoint, cargá datos de prueba si pide body y enviá la petición.
5. La respuesta HTTP y el JSON aparecen a la derecha.

La pestaña **Swagger UI** documenta la misma API REST.

Endpoints del panel:

- `GET /conductores` y `GET /conductores/{id}`
- `POST /conductores/`
- `GET /conductor/valoraciones` y `POST /conductor/valoraciones`

Esas rutas leen y escriben las valoraciones ya registradas (`conductor:{id}:valoraciones`). No muestran la valoración pendiente que genera el evento de viaje finalizado.

---

### Valoración habilitada al finalizar un viaje

Cuando el módulo de viajes publica `viaje.finalizado`, M3 hace lo siguiente:

1. El consumidor escucha el exchange `viajes.events`, routing key `viaje.finalizado`, cola `valoraciones.viaje-finalizado`.
2. Valida `viajeId`, `conductorId` y `clienteId`.
3. Guarda la valoración en Redis con la clave `valoracion:pendiente:{viajeId}` y estado `PENDIENTE`.
4. Publica `valoracion.habilitada` en el exchange `valoraciones.events`, routing key `valoracion.habilitada`, cola `cliente.valoracion-habilitada`.

Para disparar el evento sin el módulo de viajes, con la API ya iniciada:

```bash
npm run mock:viaje-finalizado
```

El mensaje publicado queda en la cola `cliente.valoracion-habilitada`. Se puede ver en RabbitMQ Management. El panel web no consume esa cola: el aviso al cliente lo tiene que leer el módulo que se suscriba a `valoracion.habilitada`.

En el evento guardado, `evaluadorId` es el conductor y `evaluadoId` es el cliente.

---

### Pruebas end-to-end con Playwright

Suite E2E que cubre el Test Runner y los contratos REST. Se ejecuta desde `M3-Conductor`, con la API y Redis disponibles.

| Comando | Descripción |
|---|---|
| `npm run test:e2e` | Suite completa, sin ventana del navegador |
| `npm run test:e2e:ui` | Interfaz de Playwright |
| `npm run test:e2e:headed` | Pruebas con el navegador visible |
| `npm run test:e2e:report` | Reporte HTML con trazas y capturas |

- **`tests/e2e/frontend.spec.js`:** carga del panel, ping al backend, `GET` y `POST` de conductores y valoraciones, historial y cambio entre Test Runner y Swagger UI.
- **`tests/e2e/api.spec.js`:** `GET /health`, CRUD de conductores y validaciones de valoraciones (parámetros faltantes y puntaje fuera de 1–5).

---

## m3-vehiculos — Vehículos y Documentación

Módulo M3 de UCP móvil: gestión de vehículos (**RF-3.2**) y documentación
asociada (**RF-3.4**) de los conductores. Parte de la entrega AE1
(Paradigmas y Lenguajes de Programación III — ISI17PL324) y de su
profundización en AE2 (Eje 3 — arquitectura y comunicación entre
aplicaciones).

### Stack

- Node.js + TypeScript (Express 5)
- Supabase (PostgreSQL) como persistencia
- Docker / Docker Compose para contenerización
- Jest (pruebas unitarias) + Playwright (pruebas End-to-End)
- Redis 7 (redis:7-alpine), como caché para idempotencia de pedidos
- RabbitMQ 3 (rabbitmq:3-management-alpine), para mensajería asíncrona entre operaciones del módulo

### Requisitos previos

- Docker y Docker Compose (para correr contenerizado), o
- Node.js 22+ y npm (para correr en local sin Docker)
- Una instancia de Supabase con las tablas `vehiculos` y `documentos` creadas

### Variables de entorno

Crear un archivo `.env` en la raíz del módulo (`m3-vehiculos/`) con:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
PORT=8083
```

- `REDIS_URL`: URL de conexión a Redis. Local (`npm run dev`): `redis://localhost:6379`. En Docker (`docker compose`): `redis://redis:6379` (nombre del servicio dentro de la red de compose).
- `RABBITMQ_URL`: URL de conexión a RabbitMQ. Local: `amqp://localhost:5672`. En Docker: `amqp://rabbitmq:5672` (nombre del servicio dentro de la red de compose).

### Ejecución con Docker (recomendado)

```bash
cd m3-vehiculos
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

#### Imagen publicada

La imagen también está disponible en Docker Hub, sin necesidad de build local:

```bash
docker pull vicbladilo/m3-vehiculos:1.1
docker run --env-file .env -p 8083:8083 vicbladilo/m3-vehiculos:1.1
```

- Repositorio: https://hub.docker.com/r/vicbladilo/m3-vehiculos
- Tags publicados: `1.0`, `1.1` (no depende de `latest`)

### Ejecución local (sin Docker)

```bash
cd m3-vehiculos
npm install
npm run dev
```

El servidor queda escuchando en `http://localhost:8083`.

### Documentación de la API

La especificación OpenAPI está en [`openapi.yaml`](m3-vehiculos/openapi.yaml). Para
visualizarla de forma interactiva, pegar el contenido en
https://editor.swagger.io, o correr localmente:

```bash
npx @scalar/cli document serve openapi.yaml
```

### Pruebas

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

### Endpoints principales

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

### Mensajería asíncrona (RabbitMQ)

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

### Propiedad de datos (RNF-04)

M3 es el único módulo con acceso de lectura/escritura directo a las tablas
`vehiculos` y `documentos` en Supabase. Ningún otro módulo del sistema lee
estas tablas directamente: si otro módulo (por ejemplo M6 — Viajes) necesita
datos de vehículos o documentación de un conductor, debe pedirlos a través
de los endpoints HTTP expuestos acá (`GET /api/v1/drivers/:driverId/vehicles`,
etc.) o, para flujos asíncronos, suscribirse a los eventos publicados en
`m3.eventos`. Esto mantiene cada módulo dueño exclusivo de su propio esquema
de datos, sin acoplamiento a nivel de base de datos entre módulos.

### Caso de concurrencia documentado (RNF-09)

Escenario: dos conductores intentan registrar un vehículo con la misma
patente al mismo tiempo. La unicidad se garantiza con una restricción
`UNIQUE` sobre la columna `patente` en la base de datos (no con un chequeo
previo en la aplicación, que tendría una ventana de carrera entre el check y
el insert). Ante dos inserts concurrentes con la misma patente, Postgres los
serializa: uno se inserta con éxito (`201`), el otro recibe el error
`23505` (unique_violation) que el repository traduce a un `409` ("Ya existe
un vehículo con esa patente"). Verificado con dos requests lanzados en
paralelo real (no secuenciales).

### Decisiones técnicas y limitaciones conocidas

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

### AE2 — Entrega individual

Esta rama (`ae2/victoria-bladilo`) parte del commit `679c3f6` (tag
`ae1-m3-base`), último commit de `m3-vehiculos` anterior al deadline
original de AE1, usado como base ante la ausencia de un tag oficial. El trabajo de AE2 construido sobre
esa base (Redis con persistencia, RabbitMQ con 2 flujos asíncronos, caso de
concurrencia documentado) corresponde a los mismos RF de AE1: RF-3.2
(vehículos) y RF-3.4 (documentación).
