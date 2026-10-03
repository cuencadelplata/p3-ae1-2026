import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../src/db/migrations";
import { createNotificationsPool } from "../../src/db/pool";
import { NotificationPersistenceError } from "../../src/notifications/notification-persistence.error";
import type { LogicalNotification } from "../../src/notifications/notification.types";
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

async function countRows(sourceMessageId: string, recipientId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications.notifications
     WHERE source_message_id = $1 AND recipient_id = $2`,
    [sourceMessageId, recipientId],
  );
  return Number(result.rows[0].count);
}

async function countOutboxRows(sourceMessageId: string, recipientId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications.outbox_events o
     JOIN notifications.notifications n ON n.notification_id = o.notification_id
     WHERE n.source_message_id = $1 AND n.recipient_id = $2`,
    [sourceMessageId, recipientId],
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
    ]);
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
      producer: "m8",
      payload: null,
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
      BEFORE INSERT ON notifications.outbox_events
      FOR EACH ROW EXECUTE FUNCTION notifications.fail_outbox_insert()`);

    try {
      await expect(outboxRepository.saveWithOutbox(notification)).rejects.toBeInstanceOf(
        NotificationPersistenceError,
      );
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS notifications_fail_outbox_insert ON notifications.outbox_events");
      await pool.query("DROP FUNCTION IF EXISTS notifications.fail_outbox_insert()");
    }

    expect(await countRows(notification.sourceMessageId, notification.recipientId)).toBe(0);
    expect(await countOutboxRows(notification.sourceMessageId, notification.recipientId)).toBe(0);
  });
});
