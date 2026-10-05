import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/http/app.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';

test('API HTTP de Entrega de Notificaciones', async (t) => {
  const sandbox = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });
  const inbox = new InMemoryInboxRepository();
  const repo = new InMemoryDeliveryRepository();
  const service = new NotificationDeliveryService(inbox, repo, sandbox);
  const handler = createApp({ deliveryService: service, sandboxProvider: sandbox });

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
  });

  await t.test('POST /internal/deliveries/simulate debe procesar entrega exitosa', async () => {
    const payload = {
      messageId: 'api-msg-001',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-api-01',
      producer: 'm8-notifications',
      data: {
        notificationId: 'notif-api-001',
        tripId: 'trip-api-01',
        recipientId: 'usr-api-1',
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

  await t.test('IDEMPOTENCIA HTTP: segundo envio con mismo messageId debe retornar DUPLICATE_IGNORED', async () => {
    const payload = {
      messageId: 'api-msg-001', // Mismo messageId
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-api-01',
      producer: 'm8-notifications',
      data: {
        notificationId: 'notif-api-001',
        tripId: 'trip-api-01',
        recipientId: 'usr-api-1',
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
    const body = (await res.json()) as { message: string; data: { duplicate: boolean; status: string } };
    assert.equal(body.data.duplicate, true);
    assert.equal(body.data.status, 'DUPLICATE_IGNORED');
  });

  await t.test('GET /internal/deliveries/:notificationId debe auditar la entrega y sus intentos', async () => {
    const res = await fetch(`${baseUrl}/internal/deliveries/notif-api-001`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { notificationId: string; status: string; attempts: unknown[] } };
    assert.equal(body.data.notificationId, 'notif-api-001');
    assert.equal(body.data.status, 'DELIVERED');
    assert.equal(body.data.attempts.length, 1);
  });

  await t.test('GET /internal/deliveries/:notificationId inexistente debe retornar 404', async () => {
    const res = await fetch(`${baseUrl}/internal/deliveries/notif-inexistente`);
    assert.equal(res.status, 404);
  });
});
