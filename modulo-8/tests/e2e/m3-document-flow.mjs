import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';

import * as amqp from 'amqplib';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env', quiet: true });

const rabbitUrl = process.env.RABBITMQ_URL;
if (!rabbitUrl) throw new Error('RABBITMQ_URL debe apuntar al broker de Compose desde el host.');
if (!process.env.M1_JWT_SECRET) throw new Error('M1_JWT_SECRET es obligatorio para registrar el device token de prueba.');

const db = new pg.Pool({
  host: 'localhost',
  port: Number(process.env.POSTGRES_HOST_PORT ?? 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});
const appUrl = `http://localhost:${process.env.M8_HOST_PORT ?? 3000}`;
const driverId = 42;
const documentId = randomUUID();
const messageId = randomUUID();
const deviceToken = `sandbox-device-m3-${documentId}`;
let tokenRegistered = false;

function jwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: driverId, role: 'CONDUCTOR', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const signature = createHmac('sha256', process.env.M1_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Tiempo agotado esperando ${label}.`);
}

const connection = await amqp.connect(rabbitUrl);
const channel = await connection.createConfirmChannel();
try {
  const health = await fetch(`${appUrl}/health/ready`);
  assert.equal(health.ok, true, 'M8 debe estar listo');

  const tokenResponse = await fetch(`${appUrl}/devices/tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ token: deviceToken, platform: 'ANDROID' }),
  });
  assert.equal(tokenResponse.status, 201, `Registro de device token: ${tokenResponse.status}`);
  tokenRegistered = true;

  const event = {
    messageId,
    eventType: 'DriverDocumentRegistered',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: documentId,
    producer: 'm3-conductores',
    data: { documentId, driverId, tipoDocumento: 'LICENCIA' },
  };
  await channel.assertExchange('m3.eventos', 'topic', { durable: true });
  const publish = async (value) => {
    channel.publish('m3.eventos', 'documento.registrado', Buffer.from(JSON.stringify(value)), {
      persistent: true,
      contentType: 'application/json',
      messageId: value.messageId,
    });
    await channel.waitForConfirms();
  };

  await publish(event);
  const first = await waitFor(async () => {
    const result = await db.query(
      `SELECT n.notification_id, n.recipient_id, o.message_id AS outbox_message_id, o.published_at,
              d.user_id, d.status, (SELECT count(*)::int FROM notification_delivery.delivery_attempts a WHERE a.delivery_id = d.delivery_id) AS attempts
         FROM notifications.notifications n
         JOIN notifications.outbox_deliveries o ON o.notification_id = n.notification_id
         LEFT JOIN notification_delivery.delivery_requests d ON d.notification_id = n.notification_id::text
        WHERE n.source_message_id = $1`,
      [messageId],
    );
    return result.rows[0]?.status === 'DELIVERED' ? result : null;
  }, 'notificación, Outbox y PUSH entregado');
  assert.equal(first.rowCount, 1);
  assert.equal(first.rows[0].recipient_id, String(driverId));
  assert.equal(Number(first.rows[0].user_id), driverId);
  assert.equal(first.rows[0].attempts, 1);
  assert.ok(first.rows[0].published_at);

  await publish(event);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const repeated = await db.query(
    `SELECT count(*)::int AS notifications,
            (SELECT count(*)::int FROM notification_delivery.delivery_requests WHERE notification_id IN
              (SELECT notification_id::text FROM notifications.notifications WHERE source_message_id = $1)) AS deliveries,
            (SELECT count(*)::int FROM notification_delivery.delivery_attempts WHERE delivery_id IN
              (SELECT delivery_id FROM notification_delivery.delivery_requests WHERE notification_id IN
                (SELECT notification_id::text FROM notifications.notifications WHERE source_message_id = $1))) AS attempts
       FROM notifications.notifications WHERE source_message_id = $1`,
    [messageId],
  );
  assert.deepEqual(repeated.rows[0], { notifications: 1, deliveries: 1, attempts: 1 });
  const inbox = await db.query(
    `SELECT status FROM messaging.inbox_events WHERE consumer_id = $1 AND message_id = $2`,
    ['m8.notificaciones.documento-registrado', messageId],
  );
  assert.equal(inbox.rows[0]?.status, 'PROCESSED');

  const dlq = 'm8.notificaciones.documento-registrado.dlq';
  const beforeInvalid = (await channel.checkQueue(dlq)).messageCount;
  const invalid = { ...event, messageId: randomUUID(), data: { ...event.data, driverId: randomUUID() } };
  await publish(invalid);
  await waitFor(async () => {
    const queue = await channel.checkQueue(dlq);
    return queue.messageCount > beforeInvalid;
  }, 'evento inválido en DLQ');

  const later = { ...event, messageId: randomUUID(), correlationId: randomUUID() };
  later.data = { ...event.data, documentId: later.correlationId };
  await publish(later);
  await waitFor(async () => {
    const result = await db.query(
      `SELECT d.status FROM notifications.notifications n
         JOIN notification_delivery.delivery_requests d ON d.notification_id = n.notification_id::text
        WHERE n.source_message_id = $1`,
      [later.messageId],
    );
    return result.rows[0]?.status === 'DELIVERED';
  }, 'mensaje válido posterior al inválido');

  console.log(JSON.stringify({ status: 'ok', sourceMessageId: messageId, notificationId: first.rows[0].notification_id,
    outboxMessageId: first.rows[0].outbox_message_id, recipientId: driverId, pushAttempts: first.rows[0].attempts,
    duplicateNotifications: repeated.rows[0].notifications, duplicateDeliveries: repeated.rows[0].deliveries,
    duplicatePushAttempts: repeated.rows[0].attempts, invalidEvent: 'DLQ', laterEvent: 'DELIVERED' }));
} finally {
  if (tokenRegistered) {
    await fetch(`${appUrl}/devices/tokens/${encodeURIComponent(deviceToken)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${jwt()}` },
    }).catch(() => undefined);
  }
  await channel.close();
  await connection.close();
  await db.end();
}
