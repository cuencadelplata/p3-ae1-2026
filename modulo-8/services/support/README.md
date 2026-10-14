# Módulo 8: Notificaciones, Documentos y Soporte (m8-soporte)

Microservicio encargado de la gestión de tickets de soporte, notificaciones y consumo asíncrono de eventos mediante RabbitMQ para la plataforma distribuida de movilidad urbana.

---

## 🐋 Imagen Docker Pública (Registry pública)

En cumplimiento con los requerimientos de la consigna de evaluación:

- **Registry / Repositorio:** Docker Hub
- **Nombre de la Imagen:** `damnia/m8-soporte`
- **Etiqueta de Versión:** `1.3`
- **Enlace Público:** [https://hub.docker.com/r/damnia/m8-soporte](https://hub.docker.com/r/damnia/m8-soporte)

### Comando para descargar la imagen pública:
```bash
docker pull damnia/m8-soporte:1.3
```

---

## 🚀 Requisitos Previos

- [Docker](https://www.docker.com/) y Docker Compose v2+ instalados.
- [Node.js](https://nodejs.org/) v20+ / v22+ (para desarrollo local opcional sin contenedores).

---

## ⚡ Ejecución Orquestada con Docker Compose

Para levantar el microservicio `m8-soporte` y el contenedor de `rabbitmq` de forma conjunta, aislada y reproducible:

```bash
# Iniciar servicios en segundo plano
docker compose up --build -d
```

### Puertos y Servicios Expuestos

- **Estado del Servicio / API Raíz:** [http://localhost:3000](http://localhost:3000)
- **Documentación Interactiva OpenAPI (Scalar):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **Panel de Administración RabbitMQ (Management):** [http://localhost:15672](http://localhost:15672)  
  *(Credenciales por defecto: Usuario: `guest` | Contraseña: `guest`)*
- **Broker RabbitMQ (Puerto AMQP):** `amqp://localhost:5672`

### Variables de Entorno

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP del servicio. |
| `SUPPORT_DATABASE_URL` | — (obligatoria) | Conexión a CommunicationsDB con el rol `m8_support`. Sin ella el servicio no arranca: no hay almacenamiento alternativo. |
| `SUPPORT_DB_SCHEMA` | `support` | Schema propio de Support. Debe ser un identificador simple. |
| `SUPPORT_DB_RETRY_MS` | `5000` | Espera entre intentos de aplicar las migraciones al arrancar. |
| `RABBITMQ_URL` | `amqp://localhost:5672` | Broker usado por el consumer heredado de AE1. |
| `SUPPORT_LEGACY_EVENTS` | `on` | `on`: conecta el consumer RabbitMQ de AE1, publica `ticket.creado` / `ticket.actualizado` y expone `POST /events/publish`. `off`: Support no se conecta al broker y la API de tickets funciona igual. Cualquier otro valor impide el arranque. |
| `M6_TRIPS_URL` | — (sin definir) | URL base del servicio de viajes de M6, por ejemplo `http://localhost:3000`. Si está definida, `POST /tickets` verifica que el viaje exista. Sin definir, la verificación queda desactivada y se avisa en el log al arrancar. |
| `M6_TIMEOUT_MS` | `2000` | Espera máxima de cada consulta a M6. Debe ser un entero positivo; sólo se valida si `M6_TRIPS_URL` está definida. |
| `SUPPORT_M1_IDENTITY_URL` | — (sin definir) | URL base de M1, por ejemplo `http://localhost:3001`. Si está definida, las rutas de `/tickets` exigen un Bearer que M1 valide. Sin definir, no se exige autenticación y se avisa en el log al arrancar. |
| `M1_TIMEOUT_MS` | `2000` | Espera máxima de cada consulta a M1. Debe ser un entero positivo; Support sólo la valida si `SUPPORT_M1_IDENTITY_URL` está definida. |

### Verificación del viaje contra M6

Con `M6_TRIPS_URL` definida, `POST /tickets` consulta `GET /api/viajes/{id}` de
M6 antes de crear el ticket. M6 es el dueño del viaje: Support sólo pregunta si
existe, no lee su estado ni lo modifica, y acepta viajes en cualquier estado.

| Respuesta de M6 | Respuesta de Support | Ticket |
| --- | --- | --- |
| `200` con el mismo `id` | `201` (o `200` en un reintento idempotente) | Se crea |
| `404`, o `400` por un id con formato inválido | `422 SUPPORT_TRIP_NOT_FOUND` | No se crea |
| Sin respuesta en `M6_TIMEOUT_MS`, error de red, otro status o cuerpo fuera de contrato | `503 SUPPORT_TRIP_SERVICE_UNAVAILABLE` con `Retry-After: 5` | No se crea |

- **Reintentos idempotentes.** Si la `Idempotency-Key` ya creó un ticket, se
  devuelve ese ticket (`200`) sin consultar a M6, también con M6 caído. La
  misma clave con otro pedido responde `409`, también sin consultar a M6. El
  viaje se verifica sólo cuando el ticket todavía no existe.
- **Sólo la creación depende de M6.** Consultar, listar y cambiar el estado de
  un ticket no lo consultan.
- **Sin circuit breaker.** Cada consulta tiene su timeout, igual que la
  consulta de Receipts a M7.
- **Health.** Con la verificación habilitada, `GET /health/ready` agrega el
  check `trips` (no crítico), que consulta `GET /health` de M6.

#### Decisión: falla cerrado

Si M6 no está disponible, el ticket **no se crea**. Es una decisión consciente:

- un ticket queda siempre asociado a un viaje que M6 confirmó;
- no hace falta un estado intermedio ni cambios en el schema;
- el cliente no pierde el pedido: lo repite con la misma `Idempotency-Key`
  después de `Retry-After`, sin riesgo de duplicarlo;
- es el mismo criterio que usa Receipts con M7 y con el autorizador fiscal.

El costo es que, mientras M6 está caído, no se pueden abrir tickets nuevos.

**Alternativa descartada:** crear el ticket "sin verificar" y validarlo cuando
M6 vuelva. Mejora la disponibilidad, pero admite tickets de viajes que no
existen y exige un estado adicional del ticket, una migración y un proceso de
reconciliación que decida qué hacer con los que nunca se confirman.

#### Estado del acuerdo con M6

El cliente se escribió contra `GET /api/viajes/{id}` tal como lo publica M6 en
`modulo6/openapi.yaml` (rama `ae2/m6-codutti-diez-mordka-mortola`). Que ese
endpoint sea el contrato canónico está **pendiente de confirmación de M6**
(ver `docs/ae2-intermodule-agreements.md`, §11). Support no usa sandbox ni
mock de M6: se conecta con el servicio real de M6 (rama
`ae2/m6-codutti-diez-mordka-mortola`). El `compose.yaml` de M8 no define
`M6_TRIPS_URL`; lo hace `compose.integracion-real.yaml`.

### Autenticación con M1

Con `SUPPORT_M1_IDENTITY_URL` definida, todas las rutas de `/tickets` exigen
`Authorization: Bearer <token>`. Support no decodifica el JWT ni conoce el
secreto de M1: reenvía la cabecera a `GET /auth/validar-identidad-y-rol` y
sólo acepta un `200` con `valid: true`, un `userId` entero positivo y un rol
de M1 (`CLIENTE`, `CONDUCTOR`, `OPERADOR`).

| Situación | Respuesta de Support |
| --- | --- |
| Sin cabecera `Authorization` | `401 SUPPORT_AUTH_REQUIRED` |
| Cabecera que no es `Bearer <token>` | `401 SUPPORT_INVALID_TOKEN`, sin consultar a M1 |
| M1 responde `401` o `403` (token inválido, vencido o revocado) | `401 SUPPORT_INVALID_TOKEN` |
| M1 responde `200` con `valid: false` (usuario inexistente o bloqueado) | `401 SUPPORT_INVALID_TOKEN` |
| Sin respuesta en `M1_TIMEOUT_MS`, error de red, otro status o cuerpo fuera de contrato | `503 SUPPORT_IDENTITY_UNAVAILABLE` con `Retry-After: 5` |

- **Autor del historial.** Con autenticación, `cambiadoPor` es `m1:<userId>`
  y `X-Actor-Id` se ignora. Sin autenticación sigue saliendo de `X-Actor-Id`.
- **Falla cerrado.** Si M1 no puede confirmar la identidad, el pedido no se
  atiende.
- **Alcance.** Sólo `/tickets`. `POST /events/publish` (heredado de AE1), la
  documentación y `/health` no exigen Bearer.
- **Health.** `GET /health/ready` agrega el check `identity` (no crítico), que
  consulta `GET /health` de M1.
- **Sólo autenticación.** Cualquier usuario válido de M1 puede operar sobre
  cualquier ticket. No hay autorización por rol ni por dueño del viaje: no
  existe una correspondencia acordada entre el `clienteId` de M6 y el `userId`
  de M1, y la autorización de tickets sigue pendiente con M1/M2.

Por qué `SUPPORT_M1_IDENTITY_URL` y no `M1_IDENTITY_URL`: en el contenedor
único de M8 esa segunda variable ya la define Receipts (RF8.4), con la URL
completa del endpoint. Si Support la leyera, la autenticación quedaría activa
en el stack normal sin que nadie la pida. El timeout sí es el compartido
`M1_TIMEOUT_MS`.

El `compose.yaml` de M8 no define `SUPPORT_M1_IDENTITY_URL`; lo hace
`compose.integracion-real.yaml`, que conecta con el M1 real (rama
`integration/m1-ae2`). Los pasos están en `infra/integracion-real/README.md`.

### Limitaciones conocidas

- **La `Idempotency-Key` es global, no por usuario.** Con la autenticación
  habilitada, si un usuario repite la misma clave y el mismo pedido que ya usó
  otro, recibe `200` con el ticket que creó el primero, y no se crea ninguno a
  su nombre; con otro pedido recibe `409`. No expone información nueva, porque
  cualquier usuario autenticado puede consultar cualquier ticket, pero el
  ticket queda a nombre de quien usó la clave primero. Los clientes deben
  generar claves únicas (por ejemplo un UUID por pedido).

### Base de Datos (CommunicationsDB)

Support guarda los tickets, su historial y las claves de idempotencia en el
schema `support` del PostgreSQL compartido de M8, con el rol `m8_support`.

- **Rol y schema:** los crea `infra/postgres/init/02-support.sh`. PostgreSQL
  sólo lo ejecuta al inicializar un volumen vacío. En un volumen que ya
  existía, aplicarlo a mano desde `modulo-8`, sin borrar datos:

  ```bash
  docker compose exec postgres sh /docker-entrypoint-initdb.d/02-support.sh
  ```

  En Git Bash sobre Windows anteponer `MSYS_NO_PATHCONV=1` para que la ruta
  no se convierta a una ruta de Windows.
- **Tablas e índices:** los crean las migraciones de Support en cada arranque.
  Son idempotentes y seguras con varias instancias.
- **Arranque sin base:** Support arranca igual, reintenta cada
  `SUPPORT_DB_RETRY_MS` y registra la causa. Mientras tanto `GET /health`
  responde 200, `GET /health/ready` responde 503 `unavailable` y los tickets
  responden 503 `SUPPORT_DB_UNAVAILABLE`.

### Health

| Ruta | Respuesta |
| --- | --- |
| `GET /health` | 200 mientras el proceso vive (forma de AE1). |
| `GET /health/live` | 200 mientras el proceso vive. |
| `GET /health/ready` | 200 `ok` o `degraded` (broker heredado caído, o M6 o M1 sin responder si su integración está habilitada); 503 `unavailable` (base caída o migraciones pendientes). Incluye el detalle de `checks`. |

### Detener los Contenedores

```bash
docker compose down
```

---

## 🧪 Ejecución de Pruebas

Desde `modulo-8`, después de `pnpm install`:

| Comando | Qué prueba | Requiere |
| --- | --- | --- |
| `pnpm --filter m8-soporte run test` | Tests unitarios: API, reglas de tickets, contrato OpenAPI y repositorio en memoria. | Nada |
| `pnpm --filter m8-soporte run test:integration` | Migraciones, repositorio PostgreSQL, concurrencia y rollback contra PostgreSQL real. Cada corrida usa un schema efímero `support_test_<aleatorio>` y lo borra al terminar. | `docker compose up -d postgres` |
| `pnpm --filter m8-soporte run prueba:resiliencia` | Apaga RabbitMQ con un mensaje en proceso: Support sigue vivo y reconecta. | Stack completo |
| `pnpm --filter m8-soporte run prueba:resiliencia:db` | Apaga PostgreSQL: tickets con 503 rápido, recuperación sin reinicio y sin estado a medias. | Stack completo |
| `pnpm --filter m8-soporte run typecheck` y `typecheck:test` | Tipos del servicio, de los tests y de los scripts. | Nada |

Los tests de integración se conectan con el usuario administrador local
(`SUPPORT_TEST_DATABASE_URL`, por defecto el de `compose.yaml`) y nunca tocan
el schema `support` real. Las dos pruebas de resiliencia vuelven a iniciar el
servicio que apagan aunque fallen.

El repositorio en memoria y el de PostgreSQL pasan exactamente los mismos casos
(`tests/shared/ticket-repository.contract.ts`).

---

## 📌 Requerimientos Funcionales Implementados

### 🟢 RF-8.5: Gestión de Tickets de Soporte
- `GET /` - Estado del servicio y mapa de endpoints.
- `POST /tickets` - Crear un ticket asociado a un viaje (`tripId`, `motivo`). `viajeId` se acepta como alias deprecado. Cabeceras opcionales `Idempotency-Key` y `X-Actor-Id`. Con `M6_TRIPS_URL` definida, verifica antes que el viaje exista en M6. Con `SUPPORT_M1_IDENTITY_URL` definida, todas las rutas de `/tickets` exigen un Bearer de M1.
- `GET /tickets/:id` - Consultar un ticket por su ID.
- `PATCH /tickets/:id/estado` - Cambiar el estado (`ABIERTO`, `EN_PROCESO`, `RESUELTO`) según las transiciones permitidas, con `expectedVersion` y `motivo` opcionales.
- `GET /tickets/:id/historial` - Historial de estados del ticket, en orden cronológico.
- `GET /tickets` - Listar tickets con filtros `tripId` y `estado` y paginación por `limit` y `cursor`.

El contrato completo, con errores y ejemplos, está en `openapi/rf85-support.yaml` y se sirve en `/api-docs`.

### 🟣 RF-8.6: Consumo Asíncrono mediante RabbitMQ
Consumo de eventos provenientes del broker en el intercambio `viajes_exchange` y la cola `m8_async_events`:
- **`viaje.asignado`:** Envío de notificación PUSH simulada al cliente.
- **`viaje.iniciado`:** Generación de código QR temporal de validación.
- **`viaje.completado`:** Generación de comprobante PDF y notificación por Email al cliente.
