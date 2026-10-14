import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';

import { createApp } from '../../src/http/app.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';

test('API HTTP de Entrega de Notificaciones', async (t) => {
  const sandbox = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });
  const inbox = new InMemoryMessagingInboxRepository();
  const repo = new InMemoryDeliveryRepository();
  const tokenRepo = new InMemoryDeviceTokenRepository();
  const m2Client = new MockM2PreferencesClient();

  // Asegurar token activo para el usuario de test con ID numérico canónico
  await tokenRepo.upsertToken(101, 'token-fcm-api-1', 'ANDROID');

  const service = new NotificationDeliveryService(
    inbox,
    repo,
    tokenRepo,
    m2Client,
    sandbox
  );
  const handler = createApp({
    deliveryService: service,
    sandboxProvider: sandbox,
    tokenRepo,
    m2Client,
    inboxRepo: inbox,
    deliveryRepo: repo,
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

  await t.test('GET /health/live debe responder 200 OK', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'ok');
  });

  await t.test('GET /health/ready debe responder 200 OK con checks', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; checks: Record<string, string> };
    assert.equal(body.status, 'ok');
    assert.equal(body.checks.inbox, 'ok');
    assert.equal(body.checks.tokens, 'ok');
  });

  await t.test('POST /internal/deliveries/simulate debe procesar entrega exitosa', async () => {
    const payload = {
      messageId: '10000000-0000-4000-8000-000000000001',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-api-01',
      producer: 'm8-notifications',
      data: {
        notificationId: '20000000-0000-4000-8000-000000000001',
        tripId: 'trip-api-01',
        recipientId: 101,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    const res = await fetch(`${baseUrl}/internal/deliveries/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { message: string; data: { status: string } };
    assert.equal(body.data.status, 'DELIVERED');
  });

  await t.test('IDEMPOTENCIA HTTP: segundo envio con mismo messageId debe retornar ACK_DUPLICATE', async () => {
    const payload = {
      messageId: '10000000-0000-4000-8000-000000000001', // Mismo messageId
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-api-01',
      producer: 'm8-notifications',
      data: {
        notificationId: '20000000-0000-4000-8000-000000000001',
        tripId: 'trip-api-01',
        recipientId: 101,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    const res = await fetch(`${baseUrl}/internal/deliveries/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { message: string; data: { actionTaken: string } };
    assert.equal(body.data.actionTaken, 'ACK_DUPLICATE');
  });

  await t.test('GET /internal/deliveries/:notificationId debe auditar la entrega y sus intentos', async () => {
    const res = await fetch(`${baseUrl}/internal/deliveries/20000000-0000-4000-8000-000000000001`, {
      headers: { Authorization: 'Bearer test-token-101' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { notificationId: string; status: string; attempts: unknown[] } };
    assert.equal(body.data.notificationId, '20000000-0000-4000-8000-000000000001');
    assert.equal(body.data.status, 'DELIVERED');
    assert.equal(body.data.attempts.length, 1);
    assert.equal('deviceToken' in body.data, false);
  });

  await t.test('GET /internal/deliveries/:notificationId inexistente debe retornar 404', async () => {
    const res = await fetch(`${baseUrl}/internal/deliveries/notif-inexistente`, {
      headers: { Authorization: 'Bearer test-token-101' },
    });
    assert.equal(res.status, 404);
  });

  await t.test('POST /internal/deliveries/simulate en PRODUCCION debe responder 403 Forbidden', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await fetch(`${baseUrl}/internal/deliveries/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'FORBIDDEN');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
