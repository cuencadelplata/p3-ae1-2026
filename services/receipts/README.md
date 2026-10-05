# m8-documentos 2.1.0: comprobantes de viaje en PDF

Servicio del **Módulo 8 (Notificaciones, Documentos y Soporte)** de la Plataforma
Distribuida de Movilidad Urbana. Emite, consulta, entrega y reenvía el comprobante PDF
de cada viaje (RF-8.3 y RF-8.4).

## Evolución individual AE2

| | |
| --- | --- |
| Autor | Juan Gualtieri (Grupo 14) |
| Versión base de AE1 | commit [`d041e61`](https://github.com/cuencadelplata/p3-ae1-2026/commit/d041e61) de la rama `M8-Notifications-QR-Receipts-Support` (unificación del módulo, `m8-documentos` 1.0.0) |
| Branch individual | [`ae2/juan-gualtieri`](https://github.com/cuencadelplata/p3-ae1-2026/tree/ae2/juan-gualtieri) |
| Alcance | RF-8.3: generación asincrónica al confirmarse el pago, persistencia sin duplicados, descarga protegida del PDF y autorización ante un servicio externo con timeout y circuit breaker |
| Tareas | Issues [#6](https://github.com/cuencadelplata/p3-ae1-2026/issues/6) a [#16](https://github.com/cuencadelplata/p3-ae1-2026/issues/16) · [tablero](https://github.com/users/JuaniGualtieri/projects/1) |

### Qué cambió respecto de AE1

| Aspecto | AE1 (1.0.0) | AE2 (2.1.0) |
| --- | --- | --- |
| Disparo de la emisión | Solo `POST /receipts` | Además, consumo de `payment.confirmed` desde RabbitMQ |
| Persistencia | JSON y PDF en un volumen | PostgreSQL, esquema `receipts` con rol propio |
| Unicidad por viaje | Candado en memoria (una sola instancia) | Restricción `UNIQUE (trip_id)` (cualquier cantidad de réplicas) |
| Mensajes repetidos | No aplica | Bandeja de entrada por `messageId` |
| Fallos de mensajería | No aplica | Cola de reintentos (3 × 5 s) y DLQ |
| Aviso de emisión | No existía | Evento `receipt.issued` mediante bandeja de salida |
| Entrega del PDF | URL estática predecible `/files/receipts/<tripId>.pdf` | Enlace temporal con token opaco en Redis (TTL 900 s) |
| Logs | Texto libre | JSON con `correlationId`, sin datos personales |
| Salud | `/health` | `/health/live` y `/health/ready` por dependencia y estado del circuito |
| Servicio externo | No había | Autorizador fiscal simulado, con timeout de 2 s y circuit breaker |
| Estado del pago | Se aceptaba el informado en la entrada | Se consulta a M7 (`GET /metodo-pago/{viajeId}`): solo se emite con el pago autorizado (2.2.0) |
| Dependencia caída | Base caída: `500`; al arrancar, el proceso terminaba | `503` con `Retry-After`; arranca sin base y se recupera solo; los pagos esperan sin ir a la DLQ |

Fundamentos: [ADR-003](docs/adr/ADR-003-backing-services-ae2.md) (RabbitMQ y Redis),
[ADR-004](docs/adr/ADR-004-persistencia-ae2.md) (persistencia) y
[ADR-005](docs/adr/ADR-005-resiliencia-ae2.md) (servicio externo, circuit breaker y dependencias caídas).

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
servicios del módulo más PostgreSQL, RabbitMQ, Redis, el autorizador fiscal simulado
(`fiscal-sandbox`) y la API de pagos de M7 simulada (`m7-payments-sandbox`); la configuración por defecto
funciona sin crear un `.env` (valores en [`modulo-8/.env.example`](../../.env.example)).

Verificación:

```powershell
curl http://localhost:3008/health/ready
# {"status":"ok","dependencies":{"postgres":{...},"redis":{...},"rabbitmq":{...},"fiscal":{...},"payments":{...}},"circuits":{"fiscal":"closed"},...}
```

| Recurso | URL |
| --- | --- |
| API | http://localhost:3008/api/v1/receipts |
| Documentación interactiva (Scalar) | http://localhost:3008/docs |
| Consola de RabbitMQ | http://localhost:15672 (guest / guest) |
| Autorizador fiscal simulado | http://localhost:4010 (`GET /admin/mode`) |
| API de pagos de M7 simulada | http://localhost:4020 (`GET /metodo-pago/{viajeId}`, `GET /admin/mode`) |

Para detener: `docker compose down`. Para borrar además los datos: `docker compose down -v`.

## Demostraciones

Con el stack levantado, desde `modulo-8/services/receipts` (requiere `pnpm install` en `modulo-8`):

| Comando | Qué muestra |
| --- | --- |
| `pnpm run demo:pago` | Publica un `payment.confirmed` como M7, su reentrega y un mensaje inválido: comprobante emitido, repetido descartado, mensaje en la DLQ y un único `receipt.issued`. |
| `pnpm run prueba:concurrencia` | 8 pedidos simultáneos del mismo viaje: un `201` y siete `200`. |
| `pnpm run prueba:replicas` | Lo mismo repartido entre **dos contenedores** del servicio. Requiere `docker compose --profile replicas up -d --build`. |

Después de cada demo: `docker compose logs receipts` (desde `modulo-8`).

### Resiliencia: apagar un backing service

Automatizada (desde `modulo-8`, unos 2 minutos): `pnpm run test:resiliencia`. Apaga de
verdad Redis, RabbitMQ, el autorizador y PostgreSQL, también al arrancar, y verifica que
el servicio siga atendiendo y se recupere solo.

A mano, desde `modulo-8`, mirando `curl http://localhost:3008/health/ready` y
`docker compose logs -f receipts`:

```powershell
docker compose stop fiscal-sandbox   # autorizador caído
pnpm --filter m8-documentos run demo:pago
# tras 3 fallas: "circuito del autorizador fiscal: open"; el pago espera en la cola
# y /health/ready muestra "degraded" y "circuits":{"fiscal":"open"}
docker compose start fiscal-sandbox  # en unos segundos el pago se emite y el circuito se cierra

# Autorizador lento: el timeout corta a los 2 s en lugar de esperar 5 s
Invoke-RestMethod -Method Put http://localhost:4010/admin/mode -Body '{"mode":"slow"}'
Invoke-RestMethod -Method Put http://localhost:4010/admin/mode -Body '{"mode":"normal"}'

docker compose stop postgres         # /health/live sigue en 200; la API responde 503
docker compose start postgres
docker compose stop redis            # solo fallan los enlaces temporales
docker compose start redis
```

## Desarrollo y pruebas

Desde `modulo-8`:

```powershell
pnpm install --frozen-lockfile
docker compose up -d --wait postgres rabbitmq redis fiscal-sandbox m7-payments-sandbox   # solo las dependencias

pnpm --filter m8-documentos run build
pnpm --filter m8-documentos run typecheck:test
pnpm --filter m8-documentos run test                 # 105 pruebas
pnpm --filter m8-documentos run dev                  # servicio en modo desarrollo
```

Las pruebas corren contra PostgreSQL, RabbitMQ, Redis y el autorizador simulado reales:

| Suite | Cubre |
| --- | --- |
| `tests/unit` | Validación, armado de eventos, logger, repositorio, circuit breaker, detección de dependencias caídas |
| `tests/integration/payment-confirmed.consumer.test.ts` | Consumo, reentrega, DLQ, reintentos agotados, recuperación, dependencia caída sin DLQ y rechazo fiscal |
| `tests/integration/fiscal-authorizer.test.ts` | Timeout, `5xx`, conexión rechazada, rechazo `422`, apertura y cierre del circuito, idempotencia del autorizador |
| `tests/integration/m7-payments.test.ts` | Cliente de M7 (`404`, `5xx`, timeout, respuesta fuera de contrato) y emisión según el pago: pendiente que se emite al autorizarse, rechazo terminal, por REST y por evento |
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

`test:e2e` corre al final la prueba de resiliencia, que apaga y vuelve a levantar
contenedores. El pipeline `.github/workflows/m8-ci.yml` ejecuta todo lo anterior en cada push.

## API

Contrato completo: [`openapi/receipts.openapi.yaml`](../../openapi/receipts.openapi.yaml).

| Método y ruta | Descripción |
| --- | --- |
| `POST /api/v1/receipts` | Emite el comprobante si M7 informa el pago autorizado. `201` nuevo, `200` si ya existía (idempotente). `409` si el pago está pendiente o sin registrar en M7; `422` si M7 lo rechazó o el autorizador fiscal rechaza el comprobante; `503` si M7 o el autorizador no responden. |
| `GET /api/v1/receipts/{tripId}` | Datos del comprobante. |
| `GET /api/v1/receipts/{tripId}/pdf` | Descarga directa del PDF. |
| `GET /api/v1/receipts/downloads/{token}` | Descarga por enlace temporal. `410` si venció. |
| `POST /api/v1/receipts/{tripId}/resend` | Registra un reenvío (entrega simulada). |
| `GET /internal/receipts/{tripId}/delivery-reference` | **Interno**, para Receipts Delivery: enlace temporal y vencimiento. |
| `GET /health/live` · `GET /health/ready` | Vitalidad y disponibilidad por dependencia. `/health` es alias de `/ready`. |

Todas las respuestas llevan `X-Correlation-Id`. Los errores usan un formato único:
`{ "error": { "code", "message", "path", "timestamp" } }`. Una dependencia caída responde
`503` con `Retry-After` (`DATABASE_UNAVAILABLE`, `FISCAL_SERVICE_UNAVAILABLE`,
`PAYMENTS_SERVICE_UNAVAILABLE`, `DOWNLOAD_LINKS_UNAVAILABLE`), nunca `500`.

## Mensajería

Contrato: [catálogo de eventos v1](../../contracts/events/catalogo-eventos-v1.md).

| Evento | Rol | Cola / routing key | Efecto |
| --- | --- | --- | --- |
| `payment.confirmed` (M7) | Consume | `m8.receipts.payment-confirmed` | Emite el comprobante |
| `receipt.issued` | Publica | `receipt.issued` en `mobility.events` | Avisa la emisión, sin datos personales |

Colas propias: la principal, `.retry` (espera entre reintentos) y `.dlq` (inválidos,
rechazados por el autorizador o con reintentos agotados), visibles en la consola de
RabbitMQ. Si PostgreSQL o el autorizador están caídos, el mensaje espera en `.retry` sin
descontar intentos y no llega a la DLQ.

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
| `DATABASE_STARTUP_RETRY_MS` | `3000` | Espera entre intentos de preparar el esquema si PostgreSQL no responde al arrancar |
| `FISCAL_API_URL` | `http://localhost:4010` | Autorizador fiscal |
| `FISCAL_TIMEOUT_MS` | `2000` | Timeout de cada autorización |
| `FISCAL_CIRCUIT_FAILURE_THRESHOLD` / `FISCAL_CIRCUIT_OPEN_MS` | `3` / `10000` | Fallas que abren el circuito y tiempo abierto |
| `M7_PAYMENTS_URL` | `http://localhost:4020` | API de pagos de M7 (estado del pago por viaje) |
| `M7_TIMEOUT_MS` | `2000` | Timeout de cada consulta a M7 |

Lista completa en [`.env.example`](.env.example). Ninguna credencial está fija en el
código: los valores por defecto son solo para el entorno local.

## Imagen Docker

La imagen es multi-stage (`Dockerfile`), corre como usuario sin privilegios y declara
un `HEALTHCHECK` sobre `/health/live`.

```powershell
# desde modulo-8
docker build -f services/receipts/Dockerfile -t juanigualtieri/m8-documentos:2.1.0 .
docker push juanigualtieri/m8-documentos:2.1.0
```

Imagen publicada: `juanigualtieri/m8-documentos:2.0.0`. La de AE1 es `arkeoff/m8-documentos:1.0.0`.

## Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| `role "m8_receipts" does not exist` al arrancar | El volumen de PostgreSQL es anterior al script de inicialización. `docker compose down -v` y volver a levantar. |
| `/health/ready` en `degraded` | Falta Redis, RabbitMQ, el autorizador fiscal o M7: el servicio sigue atendiendo y se reconecta solo. |
| `/health/ready` en `503` | PostgreSQL no responde. El servicio sigue vivo y se recupera cuando vuelve. |
| `POST /receipts` responde `503 FISCAL_SERVICE_UNAVAILABLE` | El autorizador no responde o su circuito está abierto. Revisar `docker compose ps fiscal-sandbox` y `http://localhost:4010/admin/mode`. |
| `POST /receipts` responde `409 PAYMENT_PENDING` | M7 todavía no autorizó el pago. En el sandbox: `POST http://localhost:4020/metodo-pago/{viajeId}/autorizar`. |
| Un puerto ya está en uso | Cambiar `POSTGRES_HOST_PORT` o `REDIS_HOST_PORT` en `modulo-8/.env`. |

## Documentación

| Documento | Contenido |
| --- | --- |
| [Consigna AE2](docs/consigna-ae2.md) | Alcance individual, rúbrica con su evidencia y evidencias de la entrega |
| [Arquitectura AE2](docs/arquitectura/arquitectura-ae2.md) | Componentes, propiedad de datos y secuencias |
| [ADR-003](docs/adr/ADR-003-backing-services-ae2.md) · [ADR-004](docs/adr/ADR-004-persistencia-ae2.md) · [ADR-005](docs/adr/ADR-005-resiliencia-ae2.md) | Decisiones de AE2 con alternativas comparadas |
| [Concurrencia e idempotencia AE2](docs/pruebas/concurrencia-idempotencia-ae2.md) | La carrera, su solución y cómo reproducirla |
| [Índice completo](docs/README.md) | Incluye la documentación de AE1 conservada como evidencia |
