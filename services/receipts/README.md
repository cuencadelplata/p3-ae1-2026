# m8-documentos 2.0.0: comprobantes de viaje en PDF

Servicio del **Módulo 8 (Notificaciones, Documentos y Soporte)** de la Plataforma
Distribuida de Movilidad Urbana. Emite, consulta, entrega y reenvía el comprobante PDF
de cada viaje (RF-8.3 y RF-8.4).

## Evolución individual AE2

| | |
| --- | --- |
| Autor | Juan Gualtieri (Grupo 14) |
| Versión base de AE1 | commit [`d041e61`](https://github.com/cuencadelplata/p3-ae1-2026/commit/d041e61) de la rama `M8-Notifications-QR-Receipts-Support` (unificación del módulo, `m8-documentos` 1.0.0) |
| Branch individual | [`ae2/juan-gualtieri`](https://github.com/cuencadelplata/p3-ae1-2026/tree/ae2/juan-gualtieri) |
| Alcance | RF-8.3: generación asincrónica al confirmarse el pago, persistencia sin duplicados y descarga protegida del PDF |
| Tareas | Issues [#6](https://github.com/cuencadelplata/p3-ae1-2026/issues/6) a [#15](https://github.com/cuencadelplata/p3-ae1-2026/issues/15) · [tablero](https://github.com/users/JuaniGualtieri/projects/1) |

### Qué cambió respecto de AE1

| Aspecto | AE1 (1.0.0) | AE2 (2.0.0) |
| --- | --- | --- |
| Disparo de la emisión | Solo `POST /receipts` | Además, consumo de `payment.confirmed` desde RabbitMQ |
| Persistencia | JSON y PDF en un volumen | PostgreSQL, esquema `receipts` con rol propio |
| Unicidad por viaje | Candado en memoria (una sola instancia) | Restricción `UNIQUE (trip_id)` (cualquier cantidad de réplicas) |
| Mensajes repetidos | No aplica | Bandeja de entrada por `messageId` |
| Fallos de mensajería | No aplica | Cola de reintentos (3 × 5 s) y DLQ |
| Aviso de emisión | No existía | Evento `receipt.issued` mediante bandeja de salida |
| Entrega del PDF | URL estática predecible `/files/receipts/<tripId>.pdf` | Enlace temporal con token opaco en Redis (TTL 900 s) |
| Logs | Texto libre | JSON con `correlationId`, sin datos personales |
| Salud | `/health` | `/health/live` y `/health/ready` por dependencia |

Fundamentos: [ADR-003](docs/adr/ADR-003-backing-services-ae2.md) (RabbitMQ y Redis) y
[ADR-004](docs/adr/ADR-004-persistencia-ae2.md) (persistencia).

## Puesta en marcha desde cero

Requisitos: **Docker** con Docker Compose v2 y Git. Para desarrollar o correr las
pruebas fuera de Docker: además **Node.js 24** y **pnpm 10.33.0**.

```powershell
git clone https://github.com/cuencadelplata/p3-ae1-2026.git
cd p3-ae1-2026
git checkout ae2/juan-gualtieri
cd modulo-8

docker compose up -d --build --wait
```

`--wait` termina cuando todos los contenedores están sanos. Levanta los cuatro
servicios del módulo más PostgreSQL, RabbitMQ y Redis; la configuración por defecto
funciona sin crear un `.env` (valores en [`modulo-8/.env.example`](../../.env.example)).

Verificación:

```powershell
curl http://localhost:3008/health/ready
# {"status":"ok","dependencies":{"postgres":{"status":"available",...},"redis":{...},"rabbitmq":{...}},...}
```

| Recurso | URL |
| --- | --- |
| API | http://localhost:3008/api/v1/receipts |
| Documentación interactiva (Scalar) | http://localhost:3008/docs |
| Consola de RabbitMQ | http://localhost:15672 (guest / guest) |

Para detener: `docker compose down`. Para borrar además los datos: `docker compose down -v`.

## Demostraciones

Con el stack levantado, desde `modulo-8/services/receipts` (requiere `pnpm install` en `modulo-8`):

| Comando | Qué muestra |
| --- | --- |
| `pnpm run demo:pago` | Publica un `payment.confirmed` como M7, su reentrega y un mensaje inválido: comprobante emitido, repetido descartado, mensaje en la DLQ y un único `receipt.issued`. |
| `pnpm run prueba:concurrencia` | 8 pedidos simultáneos del mismo viaje: un `201` y siete `200`. |
| `pnpm run prueba:replicas` | Lo mismo repartido entre **dos contenedores** del servicio. Requiere `docker compose --profile replicas up -d --build`. |

Después de cada demo: `docker compose logs receipts` (desde `modulo-8`).

## Desarrollo y pruebas

Desde `modulo-8`:

```powershell
pnpm install --frozen-lockfile
docker compose up -d --wait postgres rabbitmq redis   # solo las dependencias

pnpm --filter m8-documentos run build
pnpm --filter m8-documentos run typecheck:test
pnpm --filter m8-documentos run test                 # 77 pruebas
pnpm --filter m8-documentos run dev                  # servicio en modo desarrollo
```

Las pruebas corren contra PostgreSQL, RabbitMQ y Redis reales, sin simulaciones:

| Suite | Cubre |
| --- | --- |
| `tests/unit` | Validación, armado de eventos, logger, repositorio |
| `tests/integration/payment-confirmed.consumer.test.ts` | Consumo, reentrega, DLQ, reintentos agotados y recuperación |
| `tests/integration/receipt-issued.outbox.test.ts` | Publicación única, RabbitMQ caído, dos relays |
| `tests/integration/concurrencia.test.ts` | La carrera sin `UNIQUE` (8 comprobantes) frente a con `UNIQUE` (1); dos réplicas reales |
| `tests/integration/download-link.test.ts` | Enlace temporal, TTL en Redis y vencimiento (410) |
| `tests/integration/health.test.ts` | Vitalidad, disponibilidad por dependencia, correlación y ausencia de datos personales en logs |

E2E contra los contenedores (desde `modulo-8`). Con un TTL corto se verifica además el
vencimiento real del enlace:

```powershell
$env:RECEIPT_LINK_TTL_SECONDS=5; docker compose up -d --build --wait
pnpm run test:e2e
docker compose down; Remove-Item Env:RECEIPT_LINK_TTL_SECONDS
```

El pipeline `.github/workflows/m8-ci.yml` ejecuta todo lo anterior en cada push.

## API

Contrato completo: [`openapi/receipts.openapi.yaml`](../../openapi/receipts.openapi.yaml).

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/v1/receipts` | Emite el comprobante. `201` nuevo, `200` si ya existía (idempotente). |
| `GET /api/v1/receipts/{tripId}` | Datos del comprobante. |
| `GET /api/v1/receipts/{tripId}/pdf` | Descarga directa del PDF. |
| `GET /api/v1/receipts/downloads/{token}` | Descarga por enlace temporal. `410` si venció. |
| `POST /api/v1/receipts/{tripId}/resend` | Registra un reenvío (entrega simulada). |
| `GET /internal/receipts/{tripId}/delivery-reference` | **Interno**, para Receipts Delivery: enlace temporal y vencimiento. |
| `GET /health/live` · `GET /health/ready` | Vitalidad y disponibilidad por dependencia. `/health` es alias de `/ready`. |

Todas las respuestas llevan `X-Correlation-Id`. Los errores usan un formato único:
`{ "error": { "code", "message", "path", "timestamp" } }`.

## Mensajería

Contrato: [catálogo de eventos v1](../../contracts/events/catalogo-eventos-v1.md).

| Evento | Rol | Cola / routing key | Efecto |
| --- | --- | --- | --- |
| `payment.confirmed` (M7) | Consume | `m8.receipts.payment-confirmed` | Emite el comprobante |
| `receipt.issued` | Publica | `receipt.issued` en `mobility.events` | Avisa la emisión, sin datos personales |

Colas propias: la principal, `.retry` (espera entre reintentos) y `.dlq` (inválidos o
reintentos agotados), visibles en la consola de RabbitMQ.

## Configuración

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `3008` | Puerto HTTP |
| `PUBLIC_BASE_URL` | `http://localhost:3008` | Base de los enlaces devueltos |
| `RECEIPTS_DATABASE_URL` | `postgres://m8_receipts:...@localhost:5432/m8` | PostgreSQL con el rol del servicio |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | RabbitMQ |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `RECEIPT_LINK_TTL_SECONDS` | `900` | Vigencia del enlace de descarga |
| `CONSUMER_MAX_RETRIES` / `CONSUMER_RETRY_DELAY_MS` | `3` / `5000` | Reintentos del consumidor |
| `CONSUMER_PREFETCH` | `5` | Mensajes procesados en paralelo |
| `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_BATCH_SIZE` | `1000` / `20` | Relay de la bandeja de salida |

Lista completa en [`.env.example`](.env.example). Ninguna credencial está fija en el
código: los valores por defecto son solo para el entorno local.

## Imagen Docker

La imagen es multi-stage (`Dockerfile`), corre como usuario sin privilegios y declara
un `HEALTHCHECK` sobre `/health/live`.

```powershell
# desde modulo-8
docker build -f services/receipts/Dockerfile -t juanigualtieri/m8-documentos:2.0.0 .
docker push juanigualtieri/m8-documentos:2.0.0
```

Imagen publicada: `juanigualtieri/m8-documentos:2.0.0`. La de AE1 es `arkeoff/m8-documentos:1.0.0`.

## Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| `role "m8_receipts" does not exist` al arrancar | El volumen de PostgreSQL es anterior al script de inicialización. `docker compose down -v` y volver a levantar. |
| `/health/ready` en `degraded` | Falta Redis o RabbitMQ: el servicio sigue atendiendo y se reconecta solo. |
| `/health/ready` en `503` | PostgreSQL no responde. |
| Un puerto ya está en uso | Cambiar `POSTGRES_HOST_PORT` o `REDIS_HOST_PORT` en `modulo-8/.env`. |

## Documentación

| Documento | Contenido |
| --- | --- |
| [Arquitectura AE2](docs/arquitectura/arquitectura-ae2.md) | Componentes, propiedad de datos y secuencias |
| [ADR-003](docs/adr/ADR-003-backing-services-ae2.md) · [ADR-004](docs/adr/ADR-004-persistencia-ae2.md) | Decisiones de AE2 con alternativas comparadas |
| [Concurrencia e idempotencia AE2](docs/pruebas/concurrencia-idempotencia-ae2.md) | La carrera, su solución y cómo reproducirla |
| [Índice completo](docs/README.md) | Incluye la documentación de AE1 conservada como evidencia |
