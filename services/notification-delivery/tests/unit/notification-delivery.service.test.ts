import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import type { NotificationRequestedEnvelope } from '../../src/domain/delivery.types.js';

function createMockEnvelope(
  messageId: string = 'msg-001',
  notificationId: string = 'notif-001'
): NotificationRequestedEnvelope {
  return {
    messageId,
    eventType: 'NotificationRequested',
    version: 1,
    occurredAt: '2026-10-05T18:42:12.500Z',
    correlationId: 'trip-2026-000123',
    producer: 'm8-notifications',
    data: {
      notificationId,
      tripId: 'trip-2026-000123',
      recipientId: 'usr-0091',
      eventType: 'TRIP_STARTED',
      channel: 'PUSH',
      message: 'Tu viaje ha comenzado.',
      createdAt: '2026-10-05T18:42:12.000Z',
    },
  };
}

test('NotificationDeliveryService', async (t) => {
  await t.test('debe procesar y entregar exitosamente en el primer intento', async () => {
    const inbox = new InMemoryInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    const service = new NotificationDeliveryService(inbox, deliveryRepo, provider);
    const envelope = createMockEnvelope('msg-101', 'notif-101');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.duplicate, false);
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.attemptsCount, 1);
    assert.ok(result.deliveredAt);

    // Verificar en repo
    const stored = await service.getDeliveryByNotificationId('notif-101');
    assert.ok(stored);
    assert.equal(stored.status, 'DELIVERED');
    assert.equal(stored.attempts.length, 1);
    assert.equal(stored.attempts[0]?.status, 'SUCCESS');
  });

  await t.test('IDEMPOTENCIA: segundo mensaje con mismo messageId debe ignorarse sin reintentar envio push', async () => {
    const inbox = new InMemoryInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    const service = new NotificationDeliveryService(inbox, deliveryRepo, provider);
    const envelope = createMockEnvelope('msg-idem-01', 'notif-idem-01');

    // Primer procesamiento
    const res1 = await service.processNotificationRequest(envelope);
    assert.equal(res1.duplicate, false);
    assert.equal(res1.status, 'DELIVERED');
    assert.equal(provider.getSentPushes().length, 1);

    // Segundo procesamiento con el MISMO messageId (redelivery simulado)
    const res2 = await service.processNotificationRequest(envelope);
    assert.equal(res2.duplicate, true);
    assert.equal(res2.status, 'DUPLICATE_IGNORED');
    assert.equal(res2.attemptsCount, 0);

    // Garantizar que NO se volvió a disparar el PUSH
    assert.equal(provider.getSentPushes().length, 1, 'No debe disparar push ante duplicados');
  });

  await t.test('RESILIENCIA: debe reintentar ante error transitorio y tener exito dentro del limite', async () => {
    const inbox = new InMemoryInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const provider = new SandboxPushProvider({
      mode: 'FAIL_TEMPORARY',
      failuresBeforeSuccess: 2,
      simulatedDelayMs: 0,
    });

    const service = new NotificationDeliveryService(inbox, deliveryRepo, provider, {
      maxAttempts: 3,
      initialBackoffMs: 1, // ultra rapido para testing
    });

    const envelope = createMockEnvelope('msg-retry-01', 'notif-retry-01');
    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.duplicate, false);
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.attemptsCount, 3); // 2 fallos + 1 exito

    const stored = await service.getDeliveryByNotificationId('notif-retry-01');
    assert.ok(stored);
    assert.equal(stored.status, 'DELIVERED');
    assert.equal(stored.attempts.length, 3);
    assert.equal(stored.attempts[0]?.status, 'FAILED');
    assert.equal(stored.attempts[1]?.status, 'FAILED');
    assert.equal(stored.attempts[2]?.status, 'SUCCESS');
  });

  await t.test('RESILIENCIA: si se agotan los reintentos debe marcar FAILED', async () => {
    const inbox = new InMemoryInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const provider = new SandboxPushProvider({ mode: 'FAIL_ALWAYS', simulatedDelayMs: 0 });

    const service = new NotificationDeliveryService(inbox, deliveryRepo, provider, {
      maxAttempts: 3,
      initialBackoffMs: 1,
    });

    const envelope = createMockEnvelope('msg-fail-01', 'notif-fail-01');
    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.duplicate, false);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.attemptsCount, 3);
    assert.ok(result.error);

    const stored = await service.getDeliveryByNotificationId('notif-fail-01');
    assert.ok(stored);
    assert.equal(stored.status, 'FAILED');
    assert.equal(stored.attempts.length, 3);
    assert.equal(stored.attempts.every((a) => a.status === 'FAILED'), true);
  });
});
