import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EventConsumer,
  InMemoryTechnicalInbox,
  NonRetryableMessagingError,
  buildQueueTopology,
  type EventEnvelope,
} from '@m8/shared';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import { validateNotificationRequestedEnvelope } from '../../src/domain/notification-requested.contract.js';

test('Consumidor RabbitMQ / EventConsumer RF8.6 + RF8.7 Integración', async (t) => {
  const inboxStore = new InMemoryTechnicalInbox();
  const deliveryRepo = new InMemoryDeliveryRepository();
  const tokenRepo = new InMemoryDeviceTokenRepository();
  const m2Client = new MockM2PreferencesClient();
  const pushProvider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });
  const inboxRepo = new InMemoryMessagingInboxRepository();

  // Usuario con token activo y preferencias en M2
  await tokenRepo.upsertToken(201, 'fcm_token_rmq_201', 'ANDROID');
  m2Client.setPreferences(201, { notificationsEnabled: true, pushEnabled: true });

  const deliveryService = new NotificationDeliveryService(
    inboxRepo,
    deliveryRepo,
    tokenRepo,
    m2Client,
    pushProvider
  );

  const topology = buildQueueTopology({
    queue: 'm8.delivery.notification-requested',
    routingKey: 'notification.requested',
  });

  const consumer = new EventConsumer({
    consumerId: 'm8.delivery.notification-requested',
    topology: {
      queue: 'm8.delivery.notification-requested',
      routingKey: 'notification.requested',
    },
    inboxStore,
    maxRetries: 3,
  });

  consumer.registerHandler('NotificationRequested', async (rawEnvelope: EventEnvelope<any>) => {
    const envelope = validateNotificationRequestedEnvelope(rawEnvelope);
    const result = await deliveryService.processNotificationRequest(envelope, {
      skipInboxClaim: true,
    });
    if (result.actionTaken === 'FAILED') {
      throw new NonRetryableMessagingError(
        result.error ?? 'Push delivery permanently failed'
      );
    }
  });

  let ackCount = 0;
  let dlqPublished: { exchange: string; routingKey: string; content: string }[] = [];
  let retryPublished: { exchange: string; routingKey: string; content: string }[] = [];

  const createMockChannel = () => {
    ackCount = 0;
    dlqPublished = [];
    retryPublished = [];

    return {
      ack: (_msg: any) => {
        ackCount += 1;
      },
      // Declaramos exactamente 5 parámetros para que channel.publish.length >= 5
      publish: (
        exchange: string,
        routingKey: string,
        content: Buffer,
        options: Record<string, unknown>,
        callback: (err: any) => void
      ) => {
        const payloadStr = content.toString('utf8');
        if (exchange === topology.deadLetterExchange) {
          dlqPublished.push({ exchange, routingKey, content: payloadStr });
        } else if (routingKey === topology.retryQueue) {
          retryPublished.push({ exchange, routingKey, content: payloadStr });
        }
        if (typeof callback === 'function') {
          callback(null);
        }
        return true;
      },
      waitForConfirms: async () => {},
    };
  };

  const createAmqpMessage = (contentBuffer: Buffer, retryCount = 0) => ({
    fields: {
      routingKey: 'notification.requested',
      deliveryTag: 1,
      exchange: 'mobility.events',
      redelivered: false,
    },
    properties: {
      headers: {
        'x-retry-count': retryCount,
      },
    },
    content: contentBuffer,
  });

  await t.test('Flujo 1: Mensaje NotificationRequested valido es consumido, entregado y confirmado (ACK)', async () => {
    const channel = createMockChannel();
    const testMessageId = randomUUID();
    const envelope = {
      messageId: testMessageId,
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'trip-rmq-01',
      producer: 'm8-notifications',
      data: {
        notificationId: randomUUID(),
        tripId: 'trip-rmq-01',
        recipientId: 201,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje esta en curso.',
        createdAt: new Date().toISOString(),
      },
    };

    const amqpMsg = createAmqpMessage(Buffer.from(JSON.stringify(envelope), 'utf8'));
    await consumer.processMessage(channel as any, amqpMsg as any);

    assert.equal(ackCount, 1, 'El mensaje valido debe recibir ACK');
    assert.equal(pushProvider.getSentPushes().length, 1, 'Debe enviarse un push');
    assert.equal(pushProvider.getSentPushes()[0]?.recipientId, 201);
    assert.equal(dlqPublished.length, 0, 'No debe ir a DLQ');
    assert.equal(retryPublished.length, 0, 'No debe ir a retry');

    // Comprobar que quedo PROCESSED en el inboxStore
    const isProcessed = await inboxStore.hasBeenProcessed('m8.delivery.notification-requested', testMessageId);
    assert.equal(isProcessed, true, 'El mensaje debe quedar marcado como PROCESSED en inboxStore');
  });

  await t.test('Flujo 2: Mensaje duplicado ya PROCESSED recibe ACK inmediato sin reenviar PUSH', async () => {
    const channel = createMockChannel();
    const testMessageId = randomUUID();
    const envelope = {
      messageId: testMessageId,
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'trip-rmq-01',
      producer: 'm8-notifications',
      data: {
        notificationId: randomUUID(),
        tripId: 'trip-rmq-01',
        recipientId: 201,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje esta en curso.',
        createdAt: new Date().toISOString(),
      },
    };

    const amqpMsg = createAmqpMessage(Buffer.from(JSON.stringify(envelope), 'utf8'));

    // Primer procesamiento exitoso
    await consumer.processMessage(channel as any, amqpMsg as any);
    const pushCountAfterFirst = pushProvider.getSentPushes().length;

    // Segundo procesamiento (Redelivery de RabbitMQ con mismo messageId)
    await consumer.processMessage(channel as any, amqpMsg as any);

    assert.equal(ackCount, 2, 'El mensaje duplicado debe recibir ACK inmediato');
    assert.equal(pushProvider.getSentPushes().length, pushCountAfterFirst, 'NO debe enviar push duplicado');
    assert.equal(dlqPublished.length, 0);
  });

  await t.test('Flujo 3: Mensaje corrupto no JSON se envia directamente a DLQ (no reintentable)', async () => {
    const channel = createMockChannel();
    const corruptBuffer = Buffer.from('{ corrupt json content ...', 'utf8');

    const amqpMsg = createAmqpMessage(corruptBuffer);
    await consumer.processMessage(channel as any, amqpMsg as any);

    assert.equal(ackCount, 1, 'Mensaje invalido debe confirmarse tras enrutar a DLQ');
    assert.equal(dlqPublished.length, 1, 'Debe publicarse en DLQ');
    assert.equal(dlqPublished[0]?.exchange, 'mobility.events.dlx');
  });

  await t.test('Flujo 4: Usuario sin device token resulta en FAILED_NO_DEVICE_TOKEN y se envia a DLQ', async () => {
    const channel = createMockChannel();
    m2Client.setPreferences(202, { notificationsEnabled: true, pushEnabled: true });
    // Usuario 202 no tiene token

    const envelope = {
      messageId: randomUUID(),
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'trip-rmq-02',
      producer: 'm8-notifications',
      data: {
        notificationId: randomUUID(),
        tripId: 'trip-rmq-02',
        recipientId: 202,
        eventType: 'DRIVER_ARRIVED',
        channel: 'PUSH',
        message: 'Conductor llego.',
        createdAt: new Date().toISOString(),
      },
    };

    const amqpMsg = createAmqpMessage(Buffer.from(JSON.stringify(envelope), 'utf8'));
    await consumer.processMessage(channel as any, amqpMsg as any);

    assert.equal(ackCount, 1);
    assert.equal(dlqPublished.length, 1, 'Fallo permanente de falta de token va a DLQ');
  });

  await t.test('Flujo 5: Falla transitoria en M2 programa reintento en cola .retry', async () => {
    const channel = createMockChannel();
    await tokenRepo.upsertToken(203, 'fcm_token_rmq_203', 'ANDROID');
    m2Client.setShouldFail(true); // Falla M2 (503 Service Unavailable)

    const envelope = {
      messageId: randomUUID(),
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: 'trip-rmq-03',
      producer: 'm8-notifications',
      data: {
        notificationId: randomUUID(),
        tripId: 'trip-rmq-03',
        recipientId: 203,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Viaje iniciado.',
        createdAt: new Date().toISOString(),
      },
    };

    const amqpMsg = createAmqpMessage(Buffer.from(JSON.stringify(envelope), 'utf8'), 0); // Intento 0
    await consumer.processMessage(channel as any, amqpMsg as any);

    m2Client.setShouldFail(false); // Restaurar M2

    assert.equal(ackCount, 1);
    assert.equal(retryPublished.length, 1, 'Error transitorio de red debe publicarse en cola .retry');
    assert.equal(retryPublished[0]?.routingKey, 'm8.delivery.notification-requested.retry');
  });
});
