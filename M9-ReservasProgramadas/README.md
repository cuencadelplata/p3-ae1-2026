# M9 — Reservas Programadas — AE2 2.0.0

Evolución individual de Ignacio Parra en la rama `M9-AE2-Parra`. M9 crea, consulta,
modifica, cancela y activa reservas futuras. PostgreSQL es la fuente de verdad; Redis
provee caché/locks y RabbitMQ desacopla la activación del despacho.

## Arquitectura y límites

- PostgreSQL + Prisma: Reserva, Idempotency-Key, Outbox e Inbox.
- Redis: cache-aside, TTL, invalidación y lock distribuido con token.
- RabbitMQ: publisher confirms, retry con TTL y DLQ.
- M5: owner de candidatos/ofertas/asignación. Compose incluye un stub de eventos AE2.
- M7: owner del cálculo de tarifa, consumido por REST.
- M8: owner de QR/PDF; fuera de M9.

Documentación: [alcance](../docs/ae2-scope.md),
[arquitectura](../docs/architecture-ae2.md),
[eventos](../docs/event-catalog.md), [ownership](../docs/data-ownership.md),
[trazabilidad](../docs/traceability-matrix.md) y [defensa](../docs/defensa-oral-ae2.md).

## Requisitos

- Node.js 22 y npm.
- Docker Desktop/Engine con Compose 2.20+.
- Puertos libres: 3000, 5432, 6379, 5672 y 15672, o equivalentes configurados.

No requiere cuentas cloud. Las credenciales predeterminadas son únicamente locales; no
usar secretos reales en `.env.example` ni versionar `.env`.

## Inicio reproducible

Desde esta carpeta:

```bash
npm ci
copy .env.example .env
npm run local:up
docker compose ps
```

La imagen de M9 ejecuta `prisma migrate deploy` antes de iniciar. Para desarrollo sin
contenedor de M9, con PostgreSQL disponible:

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

El seed usa UUID y ubicaciones ficticias; no contiene datos privados.

## Accesos

| Recurso             | URL                                  |
| ------------------- | ------------------------------------ |
| UI                  | `http://localhost:3000/`             |
| Reservas            | `http://localhost:3000/reservas`     |
| Swagger UI          | `http://localhost:3000/docs/`        |
| OpenAPI JSON        | `http://localhost:3000/openapi.json` |
| Liveness            | `http://localhost:3000/health`       |
| Readiness           | `http://localhost:3000/readiness`    |
| RabbitMQ Management | `http://localhost:15672/`            |

`/readiness` informa por separado PostgreSQL, Redis y RabbitMQ. M5/M7 pueden degradar una
operación, pero no determinan por sí solos la salud del proceso.

## API

| Método | Ruta            | Uso                         |
| ------ | --------------- | --------------------------- |
| POST   | `/reservas`     | crear `PROGRAMADA`          |
| GET    | `/reservas`     | listar                      |
| GET    | `/reservas/:id` | consultar con cache-aside   |
| PATCH  | `/reservas/:id` | modificar solo `PROGRAMADA` |
| DELETE | `/reservas/:id` | cancelar lógicamente        |

Ejemplo:

```json
{
  "clienteId": "20000000-0000-4000-8000-000000000001",
  "origen": "Terminal",
  "destino": "Aeropuerto",
  "vehiculo": "AUTO",
  "fechaHoraProgramada": "2099-01-01T14:30:00-03:00"
}
```

## Activación y eventos

Al llegar el horario, el scheduler toma un lock Redis y ejecuta la transición condicional
`PROGRAMADA→ACTIVANDO`. Reserva y `reservation.ready-for-dispatch.v1` se guardan juntos.
El Outbox worker publica y el stub M5 responde `ride-request.assigned.v1` o
`ride-request.failed.v1`. M9 registra Inbox y resultado en una transacción. Un `eventId`
duplicado no repite el efecto.

`DISPATCH_MODE=events` es el modo Compose. `rest` conserva compatibilidad con el OpenAPI
oficial M5, pero no se ejecutan ambos modos simultáneamente. El contrato de eventos M5 es
local de demostración y espera acuerdo externo.

## Variables principales

| Variable                      | Default local            | Propósito                        |
| ----------------------------- | ------------------------ | -------------------------------- |
| `DATABASE_URL`                | PostgreSQL local M9      | fuente de verdad                 |
| `REDIS_URL`                   | `redis://localhost:6379` | caché y lock                     |
| `REDIS_CACHE_TTL_SECONDS`     | `60`                     | expiración de caché              |
| `REDIS_LOCK_TTL_MS`           | `10000`                  | coordinación temporal            |
| `RABBITMQ_URL`                | guest local              | broker                           |
| `RABBITMQ_RETRY_LIMIT`        | `3`                      | límite antes de DLQ              |
| `RABBITMQ_RETRY_DELAY_MS`     | `1000`                   | TTL de retry                     |
| `OUTBOX_POLL_INTERVAL_MS`     | `5000`                   | polling de Outbox                |
| `DISPATCH_MODE`               | `events`                 | `events` o `rest`                |
| `M5_BASE_URL` / `M7_BASE_URL` | stubs locales            | contratos REST                   |
| `M5_SERVICE_TOKEN`            | vacío                    | secreto externo; nunca versionar |

La lista completa y segura está en `.env.example`.

## Pruebas

```bash
npm run verify
npm run build
npm run test:coverage
npm run test:infrastructure
npm run test:e2e
```

- `verify`: typecheck, lint, Prettier y tests normales.
- `test:infrastructure`: levanta PostgreSQL/Redis/RabbitMQ aislados, migra, prueba
  persistencia, TTL, lock, Outbox/Inbox, duplicados, retry, DLQ y concurrencia, y limpia.
- `test:e2e`: levanta Compose completo y consume solo HTTP/RabbitMQ público.

Los últimos resultados realmente observados y bloqueos están en
[`docs/testing-evidence.md`](../docs/testing-evidence.md). No confundir un test escrito con
una ejecución aprobada.

## Detención y limpieza

```bash
npm run local:down
npm run local:clean
```

`local:clean` elimina contenedores y volúmenes PostgreSQL/Redis/RabbitMQ del proyecto.

## Imagen y release

Nombre previsto: `ignacioparra1902/m9-reservas-programadas:v2.0.0`.

```bash
docker build -t ignacioparra1902/m9-reservas-programadas:v2.0.0 .
docker push ignacioparra1902/m9-reservas-programadas:v2.0.0
docker pull ignacioparra1902/m9-reservas-programadas:v2.0.0
```

La publicación 2.0.0 está `BLOCKED_REGISTRY_AUTH` hasta autenticación y verificación de
pull. La imagen histórica 1.x no demuestra esta implementación AE2.

## Troubleshooting

- Docker no conecta: iniciar Docker Desktop y repetir `docker version`.
- Readiness PostgreSQL down: revisar `DATABASE_URL` y `docker compose logs postgres`.
- Rabbit down: las operaciones ya confirmadas dejan Outbox `PENDING`; revisar broker y
  worker.
- Mensaje en DLQ: inspeccionar headers/correlationId; corregir la causa y redrivar de forma
  controlada, no borrar silenciosamente.
- Puerto ocupado: cambiar `PORT`, `POSTGRES_PORT`, `REDIS_PORT` o `RABBITMQ_PORT` en `.env`.

## Bloqueos de contrato

- `BLOCKED_CONTRACT_M1`: identidad/token definitivo.
- `BLOCKED_CONTRACT_M4`: geocodificación/distancia/ETA real.
- `BLOCKED_CONTRACT_M5_SELECTION_POLICY`: RF-9.7 no está en OpenAPI M5.
- `BLOCKED_EXTERNAL_CONTRACT`: eventos M5 definitivos.
- QR/PDF: `PENDIENTE_CONFIRMACION_ACADEMICA`, owner M8.
