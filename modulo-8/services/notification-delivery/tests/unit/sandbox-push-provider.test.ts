import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';

test('SandboxPushProvider', async (t) => {
  await t.test('debe entregar exitosamente en modo NORMAL', async () => {
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    const result = await provider.sendPush({
      notificationId: 'notif-1',
      tripId: 'trip-1',
      recipientId: 1,
      deviceToken: 'token-abc',
      title: 'Viaje iniciado',
      body: 'Tu viaje ha comenzado',
      priority: 'NORMAL',
      correlationId: 'trip-1',
    });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.ok(result.providerMessageId?.startsWith('sandbox-fcm-'));
    assert.equal(provider.getSentPushes().length, 1);
  });

  await t.test('debe fallar en modo FAIL_ALWAYS', async () => {
    const provider = new SandboxPushProvider({ mode: 'FAIL_ALWAYS', simulatedDelayMs: 0 });

    const result = await provider.sendPush({
      notificationId: 'notif-2',
      tripId: 'trip-2',
      recipientId: 2,
      deviceToken: 'token-xyz',
      title: 'Aviso',
      body: 'Texto',
      priority: 'HIGH',
      correlationId: 'trip-2',
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 503);
    assert.ok(result.error);
  });

  await t.test('debe fallar temporalmente N veces y luego tener exito en FAIL_TEMPORARY', async () => {
    const provider = new SandboxPushProvider({
      mode: 'FAIL_TEMPORARY',
      failuresBeforeSuccess: 2,
      simulatedDelayMs: 0,
    });

    const res1 = await provider.sendPush({
      notificationId: 'notif-3',
      tripId: 'trip-3',
      recipientId: 3,
      deviceToken: 'token-123',
      title: 'Aviso',
      body: 'Texto',
      priority: 'NORMAL',
      correlationId: 'trip-3',
    });
    assert.equal(res1.success, false);

    const res2 = await provider.sendPush({
      notificationId: 'notif-3',
      tripId: 'trip-3',
      recipientId: 3,
      deviceToken: 'token-123',
      title: 'Aviso',
      body: 'Texto',
      priority: 'NORMAL',
      correlationId: 'trip-3',
    });
    assert.equal(res2.success, false);

    const res3 = await provider.sendPush({
      notificationId: 'notif-3',
      tripId: 'trip-3',
      recipientId: 3,
      deviceToken: 'token-123',
      title: 'Aviso',
      body: 'Texto',
      priority: 'NORMAL',
      correlationId: 'trip-3',
    });
    assert.equal(res3.success, true);
    assert.equal(res3.statusCode, 200);
  });
});
