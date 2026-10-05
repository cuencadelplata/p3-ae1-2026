import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/http/app.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import { InMemoryMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';

test('Prueba E2E: Flujo completo NotificationRequested -> M2 -> Device Token -> Provider PUSH', async (t) => {
  const sandbox = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });
  const inbox = new InMemoryMessagingInboxRepository();
  const deliveryRepo = new InMemoryDeliveryRepository();
  const tokenRepo = new InMemoryDeviceTokenRepository();
  const m2Client = new MockM2PreferencesClient();

  const service = new NotificationDeliveryService(
    inbox,
    deliveryRepo,
    tokenRepo,
    m2Client,
    sandbox
  );

  const handler = createApp({
    deliveryService: service,
    tokenRepo,
    m2Client,
    sandboxProvider: sandbox,
    inboxRepo: inbox,
    deliveryRepo,
  });

  let server: http.Server;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = http.createServer(handler).listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test('Paso 1: Usuario cliente registra su Device Token con JWT de M1', async () => {
    const res = await fetch(`${baseUrl}/devices/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token-usr-e2e-1',
      },
      body: JSON.stringify({
        token: 'fcm_phone_token_e2e_999',
        platform: 'ANDROID',
      }),
    });

    assert.equal(res.status, 201);
  });

  await t.test('Paso 2: Se configura preferencia activa en M2', async () => {
    m2Client.setPreferences('usr-e2e-1', { notificationsEnabled: true, pushEnabled: true });
  });

  await t.test('Paso 3: Llega evento NotificationRequested desde RabbitMQ (simulado) y se entrega con éxito', async () => {
    const envelope = {
      messageId: 'msg-e2e-001',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T19:00:00.000Z',
      correlationId: 'trip-e2e-100',
      producer: 'm8-notifications',
      data: {
        notificationId: 'notif-e2e-001',
        tripId: 'trip-e2e-100',
        recipientId: 'usr-e2e-1',
        eventType: 'DRIVER_ARRIVED',
        channel: 'PUSH',
        message: 'Tu conductor ha llegado al punto de encuentro.',
        createdAt: '2026-10-05T19:00:00.000Z',
      },
    };

    const res = await fetch(`${baseUrl}/internal/deliveries/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { status: string; attemptsCount: number } };
    assert.equal(body.data.status, 'DELIVERED');
    assert.equal(body.data.attemptsCount, 1);

    // Verificar en el sandbox que el push se dirigio al token registrado en Paso 1
    const pushes = sandbox.getSentPushes();
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]?.deviceToken, 'fcm_phone_token_e2e_999');
    assert.equal(pushes[0]?.title, 'Tu conductor ha llegado');
  });

  await t.test('Paso 4: Auditoria de la entrega en GET /internal/deliveries/:notificationId', async () => {
    const res = await fetch(`${baseUrl}/internal/deliveries/notif-e2e-001`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      data: {
        status: string;
        deviceToken: string;
        attempts: Array<{ status: string; latencyMs: number }>;
      };
    };

    assert.equal(body.data.status, 'DELIVERED');
    assert.equal(body.data.deviceToken, 'fcm_phone_token_e2e_999');
    assert.equal(body.data.attempts.length, 1);
    assert.equal(body.data.attempts[0]?.status, 'SUCCESS');
  });

  await t.test('Paso 5: Redelivery con el mismo messageId debe ignorarse de forma idempotente en Inbox', async () => {
    const envelope = {
      messageId: 'msg-e2e-001', // Mismo messageId
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T19:00:00.000Z',
      correlationId: 'trip-e2e-100',
      producer: 'm8-notifications',
      data: {
        notificationId: 'notif-e2e-001',
        tripId: 'trip-e2e-100',
        recipientId: 'usr-e2e-1',
        eventType: 'DRIVER_ARRIVED',
        channel: 'PUSH',
        message: 'Tu conductor ha llegado al punto de encuentro.',
        createdAt: '2026-10-05T19:00:00.000Z',
      },
    };

    const res = await fetch(`${baseUrl}/internal/deliveries/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { actionTaken: string } };
    assert.equal(body.data.actionTaken, 'ACK_DUPLICATE');

    // Comprobar que en el sandbox sigue habiendo solo 1 envio
    assert.equal(sandbox.getSentPushes().length, 1, 'No debe disparar push repetido ante redelivery');
  });
});
