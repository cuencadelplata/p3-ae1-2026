import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../src/db/migrations";
import { createNotificationsPool } from "../../src/db/pool";
import { NotificationPersistenceError } from "../../src/notifications/notification-persistence.error";
import { type LogicalNotification, type NormalizedTripNotificationEvent } from "../../src/notifications/notification.types";
import { createRf81Application } from "../../src/notifications/rf81-application";
import { createPostgresNotificationRepository } from "../../src/repositories/postgres-notification.repository";
import { createPostgresNotificationWithOutboxRepository } from "../../src/repositories/postgres-notification-outbox.repository";

const pool = createNotificationsPool(process.env.NOTIFICATIONS_TEST_DATABASE_URL);
const repository = createPostgresNotificationRepository(pool);
const outboxRepository = createPostgresNotificationWithOutboxRepository(pool);

function createNotification(overrides: Partial<LogicalNotification> = {}): LogicalNotification {
  return {
    notificationId: randomUUID(),
    sourceMessageId: `source-${randomUUID()}`,
    tripId: "trip-123",
    rideRequestId: null,
    recipientId: "user-456",
    eventType: "TripAssigned",
    title: "Conductor asignado",
    message: "Se asignó un conductor a tu viaje.",
    correlationId: "trip-123",
    occurredAt: "2026-10-03T15:30:00.000Z",
    createdAt: "2026-10-03T15:31:00.000Z",
    ...overrides,
  };
}

async function countRows(sourceMessageId: string, recipientId: string | number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications.notifications
     WHERE source_message_id = $1 AND recipient_id = $2`,
    [sourceMessageId, String(recipientId)],
  );
  return Number(result.rows[0].count);
}

async function countOutboxRows(sourceMessageId: string, recipientId: string | number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications.outbox_deliveries o
     JOIN notifications.notifications n ON n.notification_id = o.notification_id
     WHERE n.source_message_id = $1 AND n.recipient_id = $2`,
    [sourceMessageId, String(recipientId)],
  );
  return Number(result.rows[0].count);
}

beforeAll(async () => {
  await pool.query("DROP SCHEMA IF EXISTS notifications CASCADE");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.query("DROP SCHEMA IF EXISTS notifications CASCADE");
  await pool.end();
});

describe("PostgreSQL NotificationRepository", () => {
  it("registra sólo una vez una migración al ejecutarla dos veces", async () => {
    await runMigrations(pool);
    const migrations = await pool.query<{ version: number; name: string }>(
      "SELECT version, name FROM notifications.schema_migrations ORDER BY version",
    );

    expect(migrations.rows).toEqual([
      { version: 1, name: "create_notifications_table" },
      { version: 2, name: "create_notification_outbox_table" },
      { version: 3, name: "create_notification_outbox_pending_index" },
      { version: 4, name: "align_notification_outbox_delivery_contract" },
      { version: 5, name: "support_ride_requested_without_trip_id" },
    ]);
  });

  it("actualiza V1/V2/V3 a V4 sin perder filas ni messageId", async () => {
    const notificationId = randomUUID();
    const outboxMessageId = randomUUID();

    await pool.query("DROP SCHEMA IF EXISTS notifications CASCADE");
    await pool.query("CREATE SCHEMA notifications");
    await pool.query(`CREATE TABLE notifications.schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(
      "INSERT INTO notifications.schema_migrations (version, name) VALUES (1, 'create_notifications_table'), (2, 'create_notification_outbox_table'), (3, 'create_notification_outbox_pending_index')",
    );
    await pool.query(`CREATE TABLE notifications.notifications (
      notification_id uuid PRIMARY KEY,
      source_message_id text NOT NULL,
      trip_id text NOT NULL,
      recipient_id text NOT NULL,
      event_type text NOT NULL CHECK (event_type IN (
        'TripRequested', 'TripAssigned', 'DriverArrived',
        'TripStarted', 'TripCancelled', 'TripCompleted'
      )),
      title text NOT NULL,
      message text NOT NULL,
      correlation_id text NOT NULL,
      occurred_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT notifications_source_message_recipient_key
        UNIQUE (source_message_id, recipient_id)
    )`);
    await pool.query(`CREATE TABLE notifications.outbox_events (
      message_id uuid PRIMARY KEY,
      notification_id uuid NOT NULL REFERENCES notifications.notifications (notification_id),
      event_type text NOT NULL CHECK (event_type = 'NotificationRequested'),
      routing_key text NOT NULL CHECK (routing_key = 'notification.requested'),
      correlation_id text NOT NULL,
      version integer NOT NULL CHECK (version = 1),
      producer text NOT NULL CHECK (producer = 'm8'),
      payload jsonb NULL,
      created_at timestamptz NOT NULL,
      published_at timestamptz NULL,
      CONSTRAINT notifications_outbox_notification_event_key UNIQUE (notification_id, event_type)
    )`);
    await pool.query(`CREATE INDEX notifications_outbox_pending_created_at_idx
      ON notifications.outbox_events (created_at, message_id)
      WHERE published_at IS NULL`);
    await pool.query(
      `INSERT INTO notifications.notifications (
        notification_id, source_message_id, trip_id, recipient_id, event_type,
        title, message, correlation_id, occurred_at, created_at
      ) VALUES ($1, 'legacy-message', 'trip-legacy', 'user-legacy', 'TripAssigned',
        'Conductor asignado', 'Se asignó un conductor a tu viaje.', 'trip-legacy',
        '2026-10-03T15:30:00.000Z', '2026-10-03T15:31:00.000Z')`,
      [notificationId],
    );
    await pool.query(
      `INSERT INTO notifications.outbox_events (
        message_id, notification_id, event_type, routing_key, correlation_id,
        version, producer, payload, created_at, published_at
      ) VALUES ($1, $2, 'NotificationRequested', 'notification.requested', 'trip-legacy',
        1, 'm8', NULL, '2026-10-03T15:32:00.000Z', '2026-10-03T15:40:00.000Z')`,
      [outboxMessageId, notificationId],
    );

    await runMigrations(pool);
    await runMigrations(pool);

    const oldTable = await pool.query<{ exists: string | null }>(
      "SELECT to_regclass('notifications.outbox_events')::text AS exists",
    );
    const migrated = await pool.query<{
      message_id: string;
      producer: string;
      payload: unknown;
      published_at: Date | null;
    }>(
      "SELECT message_id, producer, payload, published_at FROM notifications.outbox_deliveries WHERE message_id = $1",
      [outboxMessageId],
    );

    expect(oldTable.rows[0].exists).toBeNull();
    expect(migrated.rows).toEqual([
      {
        message_id: outboxMessageId,
        producer: "m8-notifications",
        payload: {
          notificationId,
          tripId: "trip-legacy",
          recipientId: "user-legacy",
          eventType: "DRIVER_ASSIGNED",
          channel: "PUSH",
          message: "Se asignó un conductor a tu viaje.",
          createdAt: "2026-10-03T15:31:00.000Z",
        },
        published_at: new Date("2026-10-03T15:40:00.000Z"),
      },
    ]);

    await pool.query("DROP SCHEMA IF EXISTS notifications CASCADE");
    await runMigrations(pool);
  });

  it("persiste todos los datos de una notificación lógica", async () => {
    const notification = createNotification();

    const saved = await repository.saveIdempotent(notification);

    expect(saved).toEqual({ notification, created: true });
    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(1);
  });

  it("reconoce un duplicado por source_message_id y recipient_id", async () => {
    const first = createNotification();
    const duplicate = createNotification({
      sourceMessageId: first.sourceMessageId,
      recipientId: first.recipientId,
      notificationId: randomUUID(),
      title: "No debe persistirse",
      message: "No debe persistirse.",
    });

    const created = await repository.saveIdempotent(first);
    const reused = await repository.saveIdempotent(duplicate);

    expect(created).toEqual({ notification: first, created: true });
    expect(reused).toEqual({ notification: first, created: false });
    expect(await countRows(first.sourceMessageId, first.recipientId)).toBe(1);
  });

  it("permite el mismo source_message_id para destinatarios distintos", async () => {
    const first = createNotification();
    const second = createNotification({ sourceMessageId: first.sourceMessageId, recipientId: "user-789" });

    expect((await repository.saveIdempotent(first)).created).toBe(true);
    expect((await repository.saveIdempotent(second)).created).toBe(true);
  });

  it("permite source_message_id distintos para el mismo destinatario", async () => {
    const first = createNotification();
    const second = createNotification({ recipientId: first.recipientId });

    expect((await repository.saveIdempotent(first)).created).toBe(true);
    expect((await repository.saveIdempotent(second)).created).toBe(true);
  });

  it("mantiene una única fila ante ocho operaciones concurrentes", async () => {
    const notification = createNotification();
    const concurrent = Array.from({ length: 8 }, () =>
      repository.saveIdempotent({ ...notification, notificationId: randomUUID() }),
    );

    const results = await Promise.all(concurrent);
    const createdResult = results.find((result) => result.created);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(createdResult).toBeDefined();
    if (createdResult === undefined) {
      throw new Error("La operación concurrente no creó una notificación.");
    }
    expect(results.map((result) => result.notification.notificationId)).toEqual(
      Array(8).fill(createdResult.notification.notificationId),
    );
    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(1);

    const persisted = await pool.query<{ notification_id: string }>(
      `SELECT notification_id FROM notifications.notifications
       WHERE source_message_id = $1 AND recipient_id = $2`,
      [notification.sourceMessageId, notification.recipientId],
    );
    expect(persisted.rows).toEqual([{ notification_id: createdResult.notification.notificationId }]);
  });

  it("clasifica una falla real de PostgreSQL como error de persistencia", async () => {
    const closedPool = createNotificationsPool(process.env.NOTIFICATIONS_TEST_DATABASE_URL);
    const closedRepository = createPostgresNotificationRepository(closedPool);
    await closedPool.end();

    await expect(closedRepository.saveIdempotent(createNotification())).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );
  });

  it("persiste una Notification y una intención Outbox relacionada", async () => {
    const notification = createNotification();

    const saved = await outboxRepository.saveWithOutbox(notification);

    expect(saved).toMatchObject({ notification, created: true });
    expect(saved.outbox).toMatchObject({
      notificationId: notification.notificationId,
      eventType: "NotificationRequested",
      routingKey: "notification.requested",
      correlationId: notification.tripId,
      version: 1,
      producer: "m8-notifications",
      payload: {
        notificationId: notification.notificationId,
        tripId: notification.tripId,
        recipientId: notification.recipientId,
        eventType: "DRIVER_ASSIGNED",
        channel: "PUSH",
        message: notification.message,
        createdAt: notification.createdAt,
      },
      publishedAt: null,
    });
    expect(saved.outbox.messageId).not.toBe(notification.sourceMessageId);
    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(1);
    expect(await countOutboxRows(notification.sourceMessageId, notification.recipientId)).toBe(1);
  });

  it("no duplica la intención Outbox para una notificación idempotente", async () => {
    const first = createNotification();
    const duplicate = createNotification({
      sourceMessageId: first.sourceMessageId,
      recipientId: first.recipientId,
      notificationId: randomUUID(),
    });

    const created = await outboxRepository.saveWithOutbox(first);
    const reused = await outboxRepository.saveWithOutbox(duplicate);

    expect(created.created).toBe(true);
    expect(reused.created).toBe(false);
    expect(reused.notification).toEqual(first);
    expect(reused.outbox.messageId).toBe(created.outbox.messageId);
    expect(await countRows(first.sourceMessageId, first.recipientId)).toBe(1);
    expect(await countOutboxRows(first.sourceMessageId, first.recipientId)).toBe(1);
  });

  it("crea una notificación y Outbox distintos para otro destinatario", async () => {
    const first = createNotification();
    const second = createNotification({ sourceMessageId: first.sourceMessageId, recipientId: "user-789" });

    const firstSaved = await outboxRepository.saveWithOutbox(first);
    const secondSaved = await outboxRepository.saveWithOutbox(second);

    expect(firstSaved.notification.notificationId).not.toBe(secondSaved.notification.notificationId);
    expect(firstSaved.outbox.messageId).not.toBe(secondSaved.outbox.messageId);
  });

  it("mantiene una Notification y una Outbox ante ocho operaciones concurrentes", async () => {
    const notification = createNotification();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        outboxRepository.saveWithOutbox({ ...notification, notificationId: randomUUID() }),
      ),
    );
    const createdResult = results.find((result) => result.created);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(createdResult).toBeDefined();
    if (createdResult === undefined) {
      throw new Error("La operación concurrente no creó una notificación.");
    }
    expect(results.map((result) => result.notification.notificationId)).toEqual(
      Array(8).fill(createdResult.notification.notificationId),
    );
    expect(results.map((result) => result.outbox.messageId)).toEqual(
      Array(8).fill(createdResult.outbox.messageId),
    );
    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(1);
    expect(await countOutboxRows(notification.sourceMessageId, notification.recipientId)).toBe(1);
  });

  it("revierte Notification y Outbox si falla la inserción de la intención", async () => {
    const notification = createNotification();
    await pool.query(`CREATE FUNCTION notifications.fail_outbox_insert()
      RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'controlled outbox failure'; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER notifications_fail_outbox_insert
      BEFORE INSERT ON notifications.outbox_deliveries
      FOR EACH ROW EXECUTE FUNCTION notifications.fail_outbox_insert()`);

    try {
      await expect(outboxRepository.saveWithOutbox(notification)).rejects.toBeInstanceOf(
        NotificationPersistenceError,
      );
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS notifications_fail_outbox_insert ON notifications.outbox_deliveries");
      await pool.query("DROP FUNCTION IF EXISTS notifications.fail_outbox_insert()");
    }

    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(0);
    expect(await countOutboxRows(notification.sourceMessageId, notification.recipientId)).toBe(0);
  });

  it("lee pendientes como NotificationDeliveryIntent y conserva payload contractual", async () => {
    const notification = createNotification();
    const saved = await outboxRepository.saveWithOutbox(notification);

    const pending = await outboxRepository.findPending(10);
    const intent = pending.find((item) => item.outboxMessageId === saved.outbox.messageId);
    const storedPayload = await pool.query<{ payload: unknown }>(
      "SELECT payload FROM notifications.outbox_deliveries WHERE message_id = $1",
      [saved.outbox.messageId],
    );

    expect(intent).toEqual({
      outboxMessageId: saved.outbox.messageId,
      notificationId: notification.notificationId,
      recipientId: notification.recipientId,
      tripId: notification.tripId,
      rideRequestId: null,
      sourceMessageId: notification.sourceMessageId,
      notificationEventType: notification.eventType,
      title: notification.title,
      message: notification.message,
      correlationId: notification.correlationId,
      notificationCreatedAt: notification.createdAt,
      outboxCreatedAt: saved.outbox.createdAt,
    });
    expect(storedPayload.rows).toEqual([
      {
        payload: {
          notificationId: notification.notificationId,
          tripId: notification.tripId,
          recipientId: notification.recipientId,
          eventType: "DRIVER_ASSIGNED",
          channel: "PUSH",
          message: notification.message,
          createdAt: notification.createdAt,
        },
      },
    ]);
  });

  it("devuelve pendientes en orden FIFO y respeta limit", async () => {
    const first = await outboxRepository.saveWithOutbox(createNotification({ sourceMessageId: `fifo-a-${randomUUID()}` }));
    const second = await outboxRepository.saveWithOutbox(createNotification({ sourceMessageId: `fifo-b-${randomUUID()}` }));
    await pool.query("UPDATE notifications.outbox_deliveries SET created_at = $1 WHERE message_id = $2", [
      "2026-10-03T10:00:00.000Z",
      first.outbox.messageId,
    ]);
    await pool.query("UPDATE notifications.outbox_deliveries SET created_at = $1 WHERE message_id = $2", [
      "2026-10-03T10:00:01.000Z",
      second.outbox.messageId,
    ]);

    const pending = await outboxRepository.findPending(2);

    expect(pending.map((item) => item.outboxMessageId)).toEqual([
      first.outbox.messageId,
      second.outbox.messageId,
    ]);
  });

  it("no devuelve una intención publicada y markPublished es idempotente", async () => {
    const saved = await outboxRepository.saveWithOutbox(createNotification());
    const publishedAt = "2026-10-03T16:00:00.000Z";

    await expect(outboxRepository.markPublished(saved.outbox.messageId, publishedAt)).resolves.toBe(true);
    await expect(outboxRepository.markPublished(saved.outbox.messageId, "2026-10-03T16:05:00.000Z")).resolves.toBe(true);

    const pending = await outboxRepository.findPending(100);
    const stored = await pool.query<{ message_id: string; published_at: Date }>(
      "SELECT message_id, published_at FROM notifications.outbox_deliveries WHERE message_id = $1",
      [saved.outbox.messageId],
    );

    expect(pending.some((item) => item.outboxMessageId === saved.outbox.messageId)).toBe(false);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].message_id).toBe(saved.outbox.messageId);
    expect(stored.rows[0].published_at.toISOString()).toBe(publishedAt);
  });

  it("permite dos marcas concurrentes sin cambiar el messageId", async () => {
    const saved = await outboxRepository.saveWithOutbox(createNotification());

    const results = await Promise.all([
      outboxRepository.markPublished(saved.outbox.messageId, "2026-10-03T17:00:00.000Z"),
      outboxRepository.markPublished(saved.outbox.messageId, "2026-10-03T17:00:01.000Z"),
    ]);

    const stored = await pool.query<{ message_id: string; count: string }>(
      "SELECT message_id, count(*) OVER () AS count FROM notifications.outbox_deliveries WHERE message_id = $1",
      [saved.outbox.messageId],
    );

    expect(results).toEqual([true, true]);
    expect(stored.rows).toEqual([{ message_id: saved.outbox.messageId, count: "1" }]);
  });

  it("reclama pendientes para publicar con FOR UPDATE SKIP LOCKED sin duplicar filas bloqueadas", async () => {
    await pool.query("UPDATE notifications.outbox_deliveries SET published_at = COALESCE(published_at, now()) WHERE published_at IS NULL");
    const first = await outboxRepository.saveWithOutbox(createNotification({ sourceMessageId: `claim-a-${randomUUID()}` }));
    const second = await outboxRepository.saveWithOutbox(createNotification({ sourceMessageId: `claim-b-${randomUUID()}` }));
    await pool.query("UPDATE notifications.outbox_deliveries SET created_at = $1 WHERE message_id = $2", [
      "2026-10-03T11:00:00.000Z",
      first.outbox.messageId,
    ]);
    await pool.query("UPDATE notifications.outbox_deliveries SET created_at = $1 WHERE message_id = $2", [
      "2026-10-03T11:00:01.000Z",
      second.outbox.messageId,
    ]);

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      const claimedByA = await outboxRepository.claimPendingForPublish(clientA, 2);
      await clientB.query("BEGIN");
      const claimedByB = await outboxRepository.claimPendingForPublish(clientB, 100);

      const lockedByA = new Set(claimedByA.map((event) => event.messageId));
      expect(lockedByA.has(first.outbox.messageId)).toBe(true);
      expect(lockedByA.has(second.outbox.messageId)).toBe(true);
      expect(claimedByB.some((event) => lockedByA.has(event.messageId))).toBe(false);
    } finally {
      await clientB.query("ROLLBACK").catch(() => undefined);
      await clientA.query("ROLLBACK").catch(() => undefined);
      clientB.release();
      clientA.release();
    }
  });

  it("marca published_at con client externo sin cambiar la semantica idempotente", async () => {
    const saved = await outboxRepository.saveWithOutbox(createNotification());
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await expect(
        outboxRepository.markPublishedWithClient(client, saved.outbox.messageId, "2026-10-03T17:30:00.000Z"),
      ).resolves.toBe(true);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const stored = await pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM notifications.outbox_deliveries WHERE message_id = $1",
      [saved.outbox.messageId],
    );
    expect(stored.rows[0].published_at?.toISOString()).toBe("2026-10-03T17:30:00.000Z");
  });

  it("permite que RF8.6 controle rollback y commit de la transaccion externa", async () => {
    const application = createRf81Application({ pool });
    const rollbackEvent: NormalizedTripNotificationEvent = {
      messageId: `external-rollback-${randomUUID()}`,
      eventType: "TripStarted",
      tripId: "trip-external-rollback",
      recipientId: "user-external",
      correlationId: "trip-external-rollback",
      occurredAt: "2026-10-03T18:10:00.000Z",
    };
    const commitEvent: NormalizedTripNotificationEvent = {
      ...rollbackEvent,
      messageId: `external-commit-${randomUUID()}`,
      tripId: "trip-external-commit",
      correlationId: "trip-external-commit",
    };

    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      const result = await application.processTripEventWithClient(rollbackClient, rollbackEvent);
      expect(result).toMatchObject({ status: "SUCCESS_CREATED", valid: true, created: true });
      const insideTransaction = await rollbackClient.query<{ count: string }>(
        `SELECT count(*) FROM notifications.notifications
         WHERE source_message_id = $1 AND recipient_id = $2`,
        [rollbackEvent.messageId, rollbackEvent.recipientId],
      );
      expect(Number(insideTransaction.rows[0].count)).toBe(1);
      await rollbackClient.query("ROLLBACK");
    } finally {
      rollbackClient.release();
    }

    expect(await countRows(rollbackEvent.messageId, rollbackEvent.recipientId)).toBe(0);
    expect(await countOutboxRows(rollbackEvent.messageId, rollbackEvent.recipientId)).toBe(0);

    const commitClient = await pool.connect();
    try {
      await commitClient.query("BEGIN");
      const result = await application.processTripEventWithClient(commitClient, commitEvent);
      expect(result).toMatchObject({ status: "SUCCESS_CREATED", valid: true, created: true });
      await commitClient.query("COMMIT");
    } catch (error) {
      await commitClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      commitClient.release();
    }

    expect(await countRows(commitEvent.messageId, commitEvent.recipientId)).toBe(1);
    expect(await countOutboxRows(commitEvent.messageId, commitEvent.recipientId)).toBe(1);
  });

  it("ejecuta el flujo autónomo completo de RF8.1 sin RabbitMQ", async () => {
    const application = createRf81Application({ pool });
    await application.initialize();
    const event: NormalizedTripNotificationEvent = {
      messageId: `component-${randomUUID()}`,
      eventType: "TripCompleted",
      tripId: "trip-component-123",
      recipientId: "user-component-456",
      correlationId: "trip-component-123",
      occurredAt: "2026-10-03T18:00:00.000Z",
    };

    const created = await application.processTripEvent(event);
    const repeated = await application.processTripEvent(event);
    const pendingBefore = await application.outbox.findPending(100);

    expect(created).toMatchObject({ status: "SUCCESS_CREATED", valid: true, created: true });
    expect(repeated).toMatchObject({ status: "SUCCESS_ALREADY_PROCESSED", valid: true, created: false });
    expect(await countRows(event.messageId, event.recipientId)).toBe(1);
    expect(await countOutboxRows(event.messageId, event.recipientId)).toBe(1);

    const intent = pendingBefore.find((item) => item.sourceMessageId === event.messageId);
    expect(intent).toMatchObject({
      recipientId: event.recipientId,
      tripId: event.tripId,
      notificationEventType: event.eventType,
      correlationId: event.correlationId,
    });
    if (intent === undefined) {
      throw new Error("El flujo completo no produjo una intención pendiente.");
    }

    await expect(application.outbox.markPublished(intent.outboxMessageId, "2026-10-03T18:05:00.000Z")).resolves.toBe(true);
    const pendingAfter = await application.outbox.findPending(100);
    const published = await pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM notifications.outbox_deliveries WHERE message_id = $1",
      [intent.outboxMessageId],
    );

    expect(pendingAfter.some((item) => item.outboxMessageId === intent.outboxMessageId)).toBe(false);
    expect(published.rows[0].published_at).toBeInstanceOf(Date);
    await application.close();
  });
});
