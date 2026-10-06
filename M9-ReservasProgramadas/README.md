# M9 — Reservas Programadas — AE2 2.0.0

Evolución individual de Ignacio Parra en la rama `ae2/parra-ingaramo-ignacio`. M9 crea, consulta,
modifica, cancela y activa reservas futuras. PostgreSQL es la fuente de verdad; Redis
provee caché/locks y RabbitMQ desacopla la activación del despacho.

## Arquitectura y límites

- PostgreSQL + Prisma: Reserva, Idempotency-Key, Outbox e Inbox.
- Redis: cache-aside, TTL, invalidación y lock distribuido con token.
- RabbitMQ: publisher confirms, retry con TTL y DLQ.
- M5: owner de candidatos/ofertas/asignación. Compose incluye un stub de eventos AE2.
- M7: owner del cálculo de tarifa, consumido por REST.
- M8: owner de QR/PDF; fuera de M9.

La arquitectura, la propiedad de datos, el catálogo de eventos, la trazabilidad y las evidencias
de pruebas están consolidadas en el
[Portafolio individual de AE2](../entrega-ae2/Portafolio-Individual-AE2-M9-Ignacio-Parra.pdf).

## Requisitos

- Node.js 22 y npm.
- Docker Desktop/Engine con Compose 2.20+.
- Puertos libres: 3000, 5432, 6379, 5672 y 15672, o equivalentes configurados.

No requiere cuentas cloud. Las credenciales predeterminadas son únicamente locales; no
usar secretos reales en `.env.example` ni versionar `.env`.

## Uso del módulo

### 1. Preparar el entorno

Docker Desktop debe estar iniciado. Desde la raíz del repositorio, en PowerShell:

```powershell
npm ci
Copy-Item M9-ReservasProgramadas/.env.example M9-ReservasProgramadas/.env
npm run local:up
docker compose ps
```

También se puede trabajar directamente desde esta carpeta:

```powershell
npm ci
Copy-Item .env.example .env
npm run local:up
docker compose ps
```

`local:up` construye la imagen e inicia M9, PostgreSQL, Redis, RabbitMQ y los stubs locales
de M5 y M7. La imagen ejecuta las migraciones Prisma antes de iniciar la API. La primera
ejecución puede demorar mientras Docker descarga y construye las imágenes.

No es obligatorio modificar `.env.example`: Compose posee valores locales seguros por defecto.
El archivo `.env` permite personalizar puertos y credenciales locales y nunca debe subirse al
repositorio.

### 2. Comprobar que el módulo está disponible

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/readiness
docker compose ps
```

El resultado esperado es `status: ok` en `/health`, `status: ready` en `/readiness` y los
contenedores en estado `Up`/`healthy`. Si Docker todavía está iniciando RabbitMQ, esperar unos
segundos y repetir la comprobación.

### 3. Probar la API con Swagger UI

Abrir `http://localhost:3000/docs/`, desplegar una operación y usar **Try it out**. El orden
recomendado es:

1. `POST /reservas` para crear una reserva futura.
2. `GET /reservas` o `GET /reservas/{id}` para consultarla.
3. `PATCH /reservas/{id}` para modificarla mientras siga `PROGRAMADA`.
4. `DELETE /reservas/{id}` para cancelarla lógicamente.

Swagger usa el mismo contrato versionado en `openapi/openapi.yaml`; la representación JSON
servida por la aplicación está disponible en `http://localhost:3000/openapi.json`.

### 4. Ejecutar un CRUD desde PowerShell

La fecha debe estar en el futuro. Este ejemplo crea una reserva, la consulta, modifica y
cancela:

```powershell
$body = @{
  clienteId = "20000000-0000-4000-8000-000000000001"
  origen = "Terminal de Omnibus"
  destino = "Aeropuerto"
  vehiculo = "AUTO"
  fechaHoraProgramada = "2099-01-01T17:30:00.000Z"
} | ConvertTo-Json

$reserva = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/reservas `
  -ContentType "application/json" `
  -Body $body

$reserva
Invoke-RestMethod "http://localhost:3000/reservas/$($reserva.id)"

$cambio = @{ destino = "Puerto"; vehiculo = "MOTO" } | ConvertTo-Json
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://localhost:3000/reservas/$($reserva.id)" `
  -ContentType "application/json" `
  -Body $cambio

Invoke-RestMethod -Method Delete "http://localhost:3000/reservas/$($reserva.id)"
```

La creación devuelve `201` y estado `PROGRAMADA`. El chofer no se asigna durante el CRUD:
al llegar `fechaHoraProgramada`, el scheduler inicia el despacho y M5 selecciona/asigna al
conductor. Después de la cancelación, la reserva se conserva con estado `CANCELADA`.

### 5. Verificar persistencia

`local:down` detiene y elimina los contenedores, pero conserva los volúmenes. Al volver a
iniciar, las reservas almacenadas en PostgreSQL continúan disponibles:

```powershell
npm run local:down
npm run local:up
Invoke-RestMethod http://localhost:3000/reservas
```

Para desarrollo sin el contenedor de M9, con PostgreSQL, Redis y RabbitMQ disponibles:

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

El seed usa UUID y ubicaciones ficticias; no contiene datos privados.

### 6. Simular la caída y recuperación de PostgreSQL

Esta prueba distingue la vida del proceso de su capacidad para atender tráfico:

```powershell
docker compose stop postgres
docker compose ps

# Liveness: M9 sigue ejecutándose y responde 200.
Invoke-RestMethod http://localhost:3000/health

# Readiness: responde 503 porque PostgreSQL aparece como down.
try {
  Invoke-WebRequest http://localhost:3000/readiness -UseBasicParsing
} catch {
  "readiness HTTP $([int]$_.Exception.Response.StatusCode)"
}

# La API devuelve un error controlado y el proceso no se detiene.
try {
  Invoke-WebRequest http://localhost:3000/reservas -UseBasicParsing
} catch {
  "reservas HTTP $([int]$_.Exception.Response.StatusCode)"
}

docker compose up -d --wait postgres
Invoke-RestMethod http://localhost:3000/readiness
docker compose ps
```

En la implementación actual, un fallo inesperado de Prisma en `/reservas` se traduce a
`500 ERROR_INTERNO`; el contrato explícito de dependencia degradada es `/readiness`, que
responde `503`. Al regresar PostgreSQL, Prisma vuelve a conectarse y `/readiness` recupera
automáticamente el estado `200 ready`, sin reiniciar M9.

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

Los comandos se pueden ejecutar desde esta carpeta o desde la raíz, porque el `package.json`
principal los redirige a M9:

```powershell
npm run verify
npm run build
npm run test:coverage
npm run test:infrastructure
npm run test:e2e
```

- `verify`: typecheck, lint, Prettier y tests normales.
- `test:coverage`: genera el informe HTML en `coverage/index.html`.
- `test:infrastructure`: levanta PostgreSQL/Redis/RabbitMQ aislados, migra, prueba
  persistencia, TTL, lock, Outbox/Inbox, duplicados, retry, DLQ y concurrencia, y limpia.
- `test:e2e`: levanta Compose completo y consume solo HTTP/RabbitMQ público.

Para abrir la cobertura en Windows:

```powershell
Start-Process ./coverage/index.html
```

`test:infrastructure` y `test:e2e` administran sus propios contenedores. El E2E detiene la
composición al finalizar; ejecutar `npm run local:up` nuevamente si se desea seguir usando
el módulo.

Resultados observados el 5 de octubre de 2026: `verify` aprobó 60 pruebas,
`test:infrastructure` aprobó 10 pruebas y `test:e2e` aprobó 3 escenarios. La cobertura global
fue 89,86 % de sentencias, 77,99 % de ramas, 93,54 % de funciones y 91,54 % de líneas.

## Detención y limpieza

```powershell
npm run local:down
npm run local:clean
```

`local:down` conserva los datos. `local:clean` elimina contenedores y volúmenes PostgreSQL,
Redis y RabbitMQ del proyecto; por lo tanto, borra los datos locales y debe utilizarse solo
cuando se desea reiniciar el entorno desde cero.

## Imagen y release

Imagen publicada: `ignacioparra1902/m9-reservas-programadas:v2.0.0`.

```bash
docker build -t ignacioparra1902/m9-reservas-programadas:v2.0.0 .
docker push ignacioparra1902/m9-reservas-programadas:v2.0.0
docker pull ignacioparra1902/m9-reservas-programadas:v2.0.0
```

La descarga posterior a la publicación verificó el digest
`sha256:fa241de86c89d67607449b340db65a8a230291074c4e41025c1dbba09ae6e859`.
La imagen histórica 1.x no demuestra esta implementación AE2.

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
