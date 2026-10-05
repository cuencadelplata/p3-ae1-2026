import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';
import { Pool } from 'pg';
import { PostgresTechnicalInbox, publishWithConfirm } from '@m8/shared';
import { PgDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { PgDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { PgMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { RabbitMqDeliveryConsumer } from '../../src/infrastructure/messaging/rabbitmq-delivery-consumer.js';

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://m8_admin:m8_admin_local@localhost:5432/m8';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

test('Infraestructura Real - PostgreSQL + RabbitMQ E2E (RF8.7 + RF8.6)', async (t) => {
  let pgPool: Pool | null = null;
  let amqpConn: amqp.ChannelModel | null = null;

  // 1. Verificar disponibilidad de PostgreSQL real
  try {
    pgPool = new Pool({ connectionString: POSTGRES_URL, connectionTimeoutMillis: 1500 });
    await pgPool.query('SELECT 1');
  } catch (err) {
    if (pgPool) await pgPool.end().catch(() => {});
    t.skip(`PostgreSQL real no disponible en ${POSTGRES_URL} (omitida en entorno sin contenedores activos)`);
    return;
  }

  // 2. Verificar disponibilidad de RabbitMQ real
  try {
    amqpConn = await amqp.connect(RABBITMQ_URL);
  } catch (err) {
    if (pgPool) await pgPool.end().catch(() => {});
    t.skip(`RabbitMQ real no disponible en ${RABBITMQ_URL} (omitida en entorno sin contenedores activos)`);
    return;
  }

  t.after(async () => {
    if (amqpConn) await amqpConn.close().catch(() => {});
    if (pgPool) await pgPool.end().catch(() => {});
  });

  const tokenRepo = new PgDeviceTokenRepository(pgPool);
  const deliveryRepo = new PgDeliveryRepository(pgPool);
  const inboxStore = new PostgresTechnicalInbox(pgPool);
  const inboxRepo = new PgMessagingInboxRepository(pgPool);
  const m2Client = new MockM2PreferencesClient();
  const pushProvider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

  const deliveryService = new NotificationDeliveryService(
    inboxRepo,
    deliveryRepo,
    tokenRepo,
    m2Client,
    pushProvider
  );

  const consumer = new RabbitMqDeliveryConsumer({
    connection: amqpConn,
    inboxStore,
    deliveryService,
  });

  await consumer.start();

  const producerChannel = await amqpConn.createConfirmChannel();

  await t.test('E2E Real: Publicacion en mobility.events -> Consumo real -> Persistencia PostgreSQL -> Push Sandbox', async () => {
    const testUserId = Math.floor(Math.random() * 800000) + 100000;
    const testToken = `fcm_real_infra_${randomUUID()}`;
    const testMessageId = randomUUID();
    const testNotificationId = randomUUID();
    const testTripId = `trip-real-${randomUUID().slice(0, 8)}`;

    // 1. Guardar token en PostgreSQL real
    await tokenRepo.upsertToken(testUserId, testToken, 'ANDROID');
    m2Client.setPreferences(testUserId, { notificationsEnabled: true, pushEnabled: true });

    // 2. Publicar evento canónico en RabbitMQ
    const envelope = {
      messageId: testMessageId,
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: testTripId,
      producer: 'm8-notifications',
      data: {
        notificationId: testNotificationId,
        tripId: testTripId,
        recipientId: testUserId,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje real ha comenzado.',
        createdAt: new Date().toISOString(),
      },
    };

    await publishWithConfirm(
      producerChannel as any,
      'mobility.events',
      'notification.requested',
      Buffer.from(JSON.stringify(envelope), 'utf8'),
      { contentType: 'application/json', messageId: testMessageId }
    );

    // 3. Esperar a que el consumidor procese y persista en PostgreSQL
    let deliveryRecord = null;
    for (let i = 0; i < 25; i++) {
      deliveryRecord = await deliveryRepo.getByNotificationId(testNotificationId);
      if (deliveryRecord && deliveryRecord.status === 'DELIVERED') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.ok(deliveryRecord, 'El registro de entrega debe existir en PostgreSQL real');
    assert.equal(deliveryRecord?.status, 'DELIVERED');
    assert.equal(deliveryRecord?.userId, testUserId);
    assert.equal(deliveryRecord?.deviceToken, testToken);
    assert.ok(deliveryRecord?.attempts.length >= 1, 'Debe haber al menos 1 intento registrado en PostgreSQL');

    // 4. Verificar Inbox técnico persistido en messaging.inbox_events
    let hasBeenProcessed = false;
    for (let i = 0; i < 25; i++) {
      hasBeenProcessed = await inboxStore.hasBeenProcessed('m8.delivery.notification-requested', testMessageId);
      if (hasBeenProcessed) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(hasBeenProcessed, true, 'messaging.inbox_events debe registrar el evento como completado');

    // 5. Redelivery del mismo mensaje: no debe duplicar en PostgreSQL ni en sandbox
    const initialAttemptsCount = deliveryRecord.attempts.length;
    await publishWithConfirm(
      producerChannel as any,
      'mobility.events',
      'notification.requested',
      Buffer.from(JSON.stringify(envelope), 'utf8'),
      { contentType: 'application/json', messageId: testMessageId }
    );

    await new Promise((r) => setTimeout(r, 600));

    const checkRecord = await deliveryRepo.getByNotificationId(testNotificationId);
    assert.equal(checkRecord?.attempts.length, initialAttemptsCount, 'No deben agregarse intentos duplicados ante redelivery');
  });

  await consumer.stop();
  await producerChannel.close().catch(() => {});
});
