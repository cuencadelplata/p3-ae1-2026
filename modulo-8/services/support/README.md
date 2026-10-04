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
| `GET /health/ready` | 200 `ok` o `degraded` (broker heredado caído); 503 `unavailable` (base caída o migraciones pendientes). Incluye el detalle de `checks`. |

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
- `POST /tickets` - Crear un ticket asociado a un viaje (`tripId`, `motivo`). `viajeId` se acepta como alias deprecado. Cabeceras opcionales `Idempotency-Key` y `X-Actor-Id`.
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
