# Notifications Processing

## Responsabilidad y RF

Implementa RF8.1: procesa eventos de viaje ya ocurridos, genera el contenido de
la notificacion, persiste la notificacion logica con idempotencia de negocio y
registra una intencion Outbox transaccional `NotificationRequested`.

El endpoint AE1 `POST /notifications` se conserva para compatibilidad y procesa
`PUSH` mediante `MockPushProvider`. La entrada AE2 autonoma es el puerto
`createRf81Application(...)`, pensado para que RF8.6 entregue eventos ya
normalizados sin acoplarse a PostgreSQL, migraciones ni repositorios internos.

RF8.1 no implementa RabbitMQ, ACK/NACK, retry, DLQ, PUSH real, WebSocket,
device tokens ni RF8.7.

## Puerto AE2 de aplicacion

```ts
const app = createRf81Application({ databaseUrl });
await app.initialize();

const result = await app.processTripEvent(normalizedTripNotificationEvent);
const pending = await app.outbox.findPending(50);
await app.outbox.markPublished(pending[0].outboxMessageId, new Date().toISOString());

await app.close();
```

`processTripEvent` distingue `SUCCESS_CREATED`, `SUCCESS_ALREADY_PROCESSED`,
`INVALID_EVENT` y `PERSISTENCE_FAILURE`. Un duplicado idempotente es exito, no
conflicto funcional.
Para eventos de viaje, `recipientId` debe ser el `userId` numérico positivo de
M1. RF8.1 rechaza `clienteId` libres como `"cliente-123"`; no consulta a M2
para traducirlos. PostgreSQL conserva `recipient_id` como texto por
compatibilidad, pero el Outbox emite el número que exige RF8.7.

`NotificationDeliveryIntent` es un modelo interno de lectura del relay. El
payload oficial de `NotificationRequested.data` está acordado con RF8.7 y
mantiene `recipientId` numérico. El envelope externo y la topología de eventos
de viaje siguen pendientes de M5/M6; aún no se monta ese consumidor.

## Ejecucion desde `modulo-8/`

Requiere Node 24 y pnpm 10.33.0.

```powershell
pnpm --filter @m8/notifications-processing run build
pnpm --filter @m8/notifications-processing run test
pnpm --filter @m8/notifications-processing run test:integration
pnpm --filter @m8/notifications-processing run start
docker build -f services/notifications/Dockerfile -t m8-notifications .
```

Para pruebas PostgreSQL se requiere `NOTIFICATIONS_TEST_DATABASE_URL`.

La factory AE2 recibe `databaseUrl` o un `Pool` ya creado. Las migraciones se
ejecutan con `initialize()`; no hay efectos colaterales al importar modulos.

## Docker Compose y CommunicationsDB

En runtime Docker Compose construye `NOTIFICATIONS_DATABASE_URL` con el rol
propio `m8_notifications` y el password local configurable mediante
`NOTIFICATIONS_DB_PASSWORD`.

El contenedor `postgres` ejecuta `infra/postgres/init/03-notifications.sh` al
inicializar un volumen vacio. Ese script prepara rol, schema y permisos, pero no
crea tablas funcionales. Las tablas `notifications.notifications`,
`notifications.outbox_deliveries` y `notifications.schema_migrations` las crea
RF8.1 con `runMigrations(pool)` durante `initialize()`.

Si el volumen `m8-postgres` ya existia antes de agregar el init script, preparar
el rol manualmente sin borrar datos:

```powershell
docker compose exec postgres sh /docker-entrypoint-initdb.d/03-notifications.sh
```

Usa `PORT` (3000 por defecto); Compose publica `3101`. Endpoints HTTP AE1:
`GET /health` y `POST /notifications`. El contrato canonico esta en
`../../openapi/notifications.openapi.yaml`.
