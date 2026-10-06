# AE2 — Etapa 2: diseño del bootstrap único de M8

**Estado:** propuesta técnica previa a implementación.  
**Objetivo:** definir cómo alojar RF8.1–RF8.7 en una única aplicación HTTP y
un único proceso Node.js, sin borrar la separación interna de los módulos.

## Principio de composición

La aplicación común no debe montar sin más las aplicaciones completas que hoy
crea cada RF. Esas aplicaciones ya incluyen `express.json`, contextos de
correlación, rutas de health, documentación y manejadores de errores propios;
montarlas unas dentro de otras produciría rutas duplicadas, orden de middleware
ambiguo y errores difíciles de aislar.

La estrategia propuesta es conservar en cada RF su lógica de dominio y
extraer, cuando sea necesario, dos fronteras explícitas:

1. **Runtime del RF:** crea conexiones, repositorios, servicios, consumidores
   asíncronos y checks de disponibilidad. Expone `initialize`, `close` y un
   estado de readiness.
2. **Router del RF:** registra únicamente sus rutas HTTP en un router Express
   proporcionado por la aplicación M8. No abre puertos ni instala middleware
   global.

## Estructura objetivo propuesta

```text
modulo-8/
├── src/
│   ├── app.ts                  # Express común: middleware y rutas
│   ├── server.ts               # único listen() y señales SIGTERM/SIGINT
│   ├── bootstrap/
│   │   ├── runtime.ts          # composición de runtimes RF8.1–RF8.7
│   │   └── config.ts           # validación de configuración externa común
│   ├── health/
│   │   └── health-router.ts    # /health/live, /health/ready y /health
│   └── docs/
│       └── openapi-router.ts   # contrato y documentación unificados
├── services/
│   ├── notifications/
│   ├── qr/
│   ├── receipts/
│   ├── support/
│   ├── notification-delivery/
│   └── shared/
└── ...
```

`src/` representa la composición técnica común. Los directorios dentro de
`services/` siguen siendo propietarios de reglas de negocio, validación,
persistencia, contratos y adaptadores de su RF.

## Responsabilidad del bootstrap

El bootstrap único debe construir una instancia de runtime por RF:

```text
createM8Runtime(config)
  ├── notificationsRuntime
  ├── qrRuntime
  ├── receiptsRuntime
  ├── supportRuntime
  ├── deliveryRuntime
  └── messagingRuntime (RF8.6 compartido)
```

Cada runtime debe poder:

- inicializar sus recursos sin abrir un puerto HTTP;
- informar salud de sus dependencias;
- iniciar sus workers asíncronos cuando corresponda;
- cerrar ordenadamente sus conexiones;
- mantener sus propios límites de datos y configuración.

El bootstrap común no debe conocer reglas de notificación, tokens QR,
generación PDF, tickets ni delivery PUSH. Sólo coordina ciclo de vida,
configuración, health y montaje de rutas.

## Adaptación prevista por RF

| RF | Estado actual | Adaptación mínima propuesta |
| --- | --- | --- |
| RF8.1 Notifications | Tiene `createRf81Application` y Express propio. | Reutilizar `Rf81Application`; extraer un registrador HTTP que reciba sus dependencias reales. |
| RF8.2 QR | Ya separa `createApp`, `QrService` y Redis. | Extraer el armado de runtime de `server.ts`; reutilizar `registerQrRoutes`. |
| RF8.3 / RF8.4 Receipts | Desde `099ca41` expone `createReceiptsModule()`, con router, checks, readiness, start y stop. | Montarlo como primer runtime de referencia; preservar `index.ts` para el modo independiente mientras se valida la aplicación común. |
| RF8.5 Support | Ya ofrece `registerSupportRoutes`. | Reutilizar el runtime creado por `buildSupportFromEnv`; evitar montar su app completa. |
| RF8.6 Messaging | Está repartido entre consumidores y adaptadores compartidos. | Centralizar la topología y lifecycle técnico sin absorber reglas de negocio de cada RF. |
| RF8.7 Delivery | Tiene listener HTTP nativo de Node. | Extraer un router/adaptador Express y un runtime para PostgreSQL, RabbitMQ, M2 y PUSH sandbox. |

La adaptación de RF8.7 es la más sensible: no debe perder autenticación M1,
idempotencia de Inbox, delivery, reintentos, DLQ ni el control de acceso a
device tokens.

## Middleware y rutas comunes

La aplicación M8 instala una sola vez:

- `express.json` con un límite acordado;
- generación y propagación de `X-Correlation-Id`;
- rutas de health comunes;
- publicación del contrato OpenAPI y documentación;
- fallback de ruta no encontrada.

Cada router conserva su manejo de errores de dominio dentro de su alcance. No
se obliga a que todos los RF adopten de inmediato el mismo tipo de error
interno; el objetivo inicial es preservar su respuesta contractual actual y
evitar que un error de un RF altere el comportamiento de otro.

## Health común propuesto

| Ruta | Significado |
| --- | --- |
| `GET /health/live` | El proceso único de M8 está vivo; no consulta dependencias. |
| `GET /health/ready` | Resume el estado de PostgreSQL, Redis, RabbitMQ y los runtimes activos. |
| `GET /health` | Alias de `/health/ready`. |

La respuesta debe indicar `ok`, `degraded` o `unavailable`, junto con checks
por dependencia o módulo. Una dependencia no crítica para una operación no
debe derribar el proceso completo: por ejemplo, una caída de Redis afecta QR y
enlaces temporales, pero no debe impedir atender tickets que dependen de
PostgreSQL.

La clasificación HTTP definitiva de `degraded` se fijará junto con los tests
de health; no debe contradecir los contratos ya expuestos por los RF.

## Ciclo de vida y cierre

`src/server.ts` será el único archivo que ejecuta `listen`. Ante `SIGTERM` o
`SIGINT` debe:

1. dejar de aceptar solicitudes HTTP;
2. detener consumidores y relays RabbitMQ;
3. cerrar conexiones Redis y PostgreSQL de cada runtime;
4. finalizar el proceso con un código coherente.

Los entrypoints individuales actuales se mantienen hasta que el bootstrap
común tenga pruebas equivalentes. No se eliminan antes de validar la nueva
composición.

## Configuración externa

La configuración permanece externa. El bootstrap recibe y distribuye, sin
hardcodear secretos, variables como:

- URLs y credenciales de PostgreSQL por schema/rol de M8;
- `REDIS_URL`, `QR_TTL_SECONDS` y TTL de enlaces;
- `RABBITMQ_URL` y topología compartida;
- URLs de M1, M2, M7 y sandbox fiscal;
- `M1_JWT_SECRET` y `M2_INTERNAL_API_KEY`, obligatorias sólo donde el RF8.7
  las necesita en producción.

No se agrega autenticación M2M inventada y no se accede a Redis ni a bases de
datos de módulos externos.

## Pruebas necesarias antes de retirar entrypoints individuales

1. Cada router preserva sus rutas y respuestas contractuales.
2. Un arranque de la app única inicializa los recursos requeridos.
3. Una dependencia caída se refleja en `/health/ready` sin perder
   `/health/live`.
4. Los workers RabbitMQ de Receipts, Notifications y Delivery conservan ACK,
   NACK, retry, DLQ, Inbox y Outbox.
5. Los flujos de RF8.1 a RF8.7 se ejecutan contra un único puerto de M8.
6. La imagen única y Compose se validan desde un entorno limpio.

## Decisión requerida antes de codificar

Se debe aprobar esta estrategia de bootstrap por routers y runtimes. Una vez
aprobada, el primer cambio de código debe ser únicamente crear la estructura
de `src/` común, sin eliminar todavía servidores, Dockerfiles ni rutas
individuales.
