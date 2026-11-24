import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';

import { parseWebPushSubscription, WebPushProvider } from '../../src/infrastructure/provider/web-push-provider.js';

const request = (deviceToken: string) => ({
  notificationId: 'n-1',
  tripId: 'trip-1',
  recipientId: 42,
  deviceToken,
  title: 'Tu conductor ha llegado',
  body: 'Te espera en el punto de partida.',
  priority: 'NORMAL' as const,
  correlationId: 'trip-1',
});

const subscription = JSON.stringify({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'clave-p256dh', auth: 'clave-auth' },
});

test('Proveedor Web Push', async (t) => {
  await t.test('reconoce una suscripción de navegador y descarta otros tokens', () => {
    assert.equal(parseWebPushSubscription(subscription)?.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
    assert.equal(parseWebPushSubscription('device-android-123'), null);
    assert.equal(parseWebPushSubscription(JSON.stringify({ endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } })), null);
  });

  await t.test('sin claves VAPID falla sin reintentos y lo informa', async () => {
    const provider = new WebPushProvider({});
    assert.equal(provider.isConfigured(), false);
    const result = await provider.sendPush(request(subscription));
    assert.equal(result.success, false);
    assert.equal(result.isTransient, false);
    assert.match(result.error ?? '', /VAPID/);
  });

  await t.test('un token que no es de navegador no tiene proveedor', async () => {
    const keys = webpush.generateVAPIDKeys();
    const provider = new WebPushProvider({ ...keys, subject: 'mailto:prueba@example.com' });
    const result = await provider.sendPush(request('device-android-123'));
    assert.equal(result.success, false);
    assert.equal(result.statusCode, 422);
    assert.equal(result.isTransient, false);
  });
});
