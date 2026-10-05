import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import type { NotificationRequestedEnvelope } from '../../src/domain/delivery.types.js';

function createMockEnvelope(
  messageId: string = 'msg-001',
  notificationId: string = 'notif-001',
  recipientId: string = 'usr-0091'
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
      recipientId,
      eventType: 'TRIP_STARTED',
      channel: 'PUSH',
      message: 'Tu viaje ha comenzado.',
      createdAt: '2026-10-05T18:42:12.000Z',
    },
  };
}

test('NotificationDeliveryService - Suite de Casos Obligatorios RF8.7', async (t) => {
  // CASO 1: Preferencia ON -> Despacho PUSH exitoso
  await t.test('CASO 1: Preferencia ON en M2 debe efectuar delivery PUSH exitoso', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    // Preconfigurar preferencia ON y token registrado
    m2Client.setPreferences('usr-0091', { notificationsEnabled: true, pushEnabled: true });
    await tokenRepo.upsertToken('usr-0091', 'fcm_token_valid_123', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-on-1', 'notif-on-1', 'usr-0091');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'DELIVERED');
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.attemptsCount, 1);
    assert.equal(provider.getSentPushes().length, 1);
    assert.equal(provider.getSentPushes()[0]?.deviceToken, 'fcm_token_valid_123');
  });

  // CASO 2: Preferencia OFF -> Omite PUSH, no falla, marca SKIPPED
  await t.test('CASO 2: Preferencia OFF en M2 debe omitir envio PUSH limpiamente (SKIPPED_PREFERENCE_OFF)', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    // Usuario desactivo notificaciones en M2
    m2Client.setPreferences('usr-silent', { notificationsEnabled: false, pushEnabled: false });
    await tokenRepo.upsertToken('usr-silent', 'token-silent', 'IOS');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-off-1', 'notif-off-1', 'usr-silent');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'SKIPPED_PREFERENCE_OFF');
    assert.equal(result.status, 'SKIPPED_PREFERENCE_OFF');
    assert.equal(result.attemptsCount, 0);
    assert.equal(provider.getSentPushes().length, 0, 'No debe disparar push si preferencia esta OFF');

    // Debe quedar marcado PROCESSED en inbox para hacer ACK
    const inboxRec = await inbox.getRecord('m8.delivery.notification-requested', 'msg-off-1');
    assert.equal(inboxRec?.status, 'PROCESSED');
  });

  // CASO 3: Usuario sin device token -> Falla controlada FAILED_NO_DEVICE_TOKEN
  await t.test('CASO 3: Usuario sin device token registrado debe finalizar con FAILED_NO_DEVICE_TOKEN sin reintentos infinitos', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    m2Client.setPreferences('usr-no-token', { notificationsEnabled: true, pushEnabled: true });
    // No registramos token para usr-no-token

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-notoken-1', 'notif-notoken-1', 'usr-no-token');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'FAILED');
    assert.equal(result.status, 'FAILED_NO_DEVICE_TOKEN');
    assert.equal(result.attemptsCount, 0);
    assert.equal(provider.getSentPushes().length, 0);

    const inboxRec = await inbox.getRecord('m8.delivery.notification-requested', 'msg-notoken-1');
    assert.equal(inboxRec?.status, 'PROCESSED');
  });

  // CASO 4: Token actualizado -> Despacha al ultimo token activo
  await t.test('CASO 4: Token actualizado debe enviar el PUSH al token mas reciente', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    m2Client.setPreferences('usr-update', { notificationsEnabled: true, pushEnabled: true });
    await tokenRepo.upsertToken('usr-update', 'token-antiguo', 'ANDROID');
    // Usuario actualiza token (ej. reinstalo la app)
    await tokenRepo.upsertToken('usr-update', 'token-nuevo-actualizado', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-upd-1', 'notif-upd-1', 'usr-update');

    await service.processNotificationRequest(envelope);

    assert.equal(provider.getSentPushes().length, 1);
    assert.equal(provider.getSentPushes()[0]?.deviceToken, 'token-nuevo-actualizado');
  });

  // CASO 5: Provider caido o lento -> Agota 3 reintentos con backoff y pasa a FAILED/DLQ
  await t.test('CASO 5: Provider caido debe ejecutar exactamente 3 reintentos antes de marcar FAILED (DLQ)', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'FAIL_ALWAYS', simulatedDelayMs: 0 });

    await tokenRepo.upsertToken('usr-provider-fail', 'token-pf', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider, {
      maxAttempts: 3,
      initialBackoffMs: 1,
    });
    const envelope = createMockEnvelope('msg-pf-1', 'notif-pf-1', 'usr-provider-fail');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'FAILED');
    assert.equal(result.status, 'FAILED');
    assert.equal(result.attemptsCount, 3);
    assert.equal(provider.getSentPushes().length, 3);

    const inboxRec = await inbox.getRecord('m8.delivery.notification-requested', 'msg-pf-1');
    assert.equal(inboxRec?.status, 'FAILED');
  });

  // CASO 6: M2 caido -> Lanza excepcion de resiliencia
  await t.test('CASO 6: M2 caido debe lanzar error para activar politica de reintento de infraestructura', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    m2Client.setShouldFail(true); // Simular M2 caido

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-m2-fail', 'notif-m2-fail', 'usr-m2');

    await assert.rejects(async () => {
      await service.processNotificationRequest(envelope);
    }, /\[M2_CLIENT_ERROR\]/);

    assert.equal(provider.getSentPushes().length, 0);
  });

  // CASO 7: Retry y recuperacion -> Falla intentos 1 y 2, exito en intento 3
  await t.test('CASO 7: Retry y recuperacion tras caida transitoria del provider', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({
      mode: 'FAIL_TEMPORARY',
      failuresBeforeSuccess: 2,
      simulatedDelayMs: 0,
    });

    await tokenRepo.upsertToken('usr-recover', 'token-rec', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider, {
      maxAttempts: 3,
      initialBackoffMs: 1,
    });
    const envelope = createMockEnvelope('msg-rec-1', 'notif-rec-1', 'usr-recover');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'DELIVERED');
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.attemptsCount, 3); // 2 fallos + 1 exito

    const stored = await service.getDeliveryByNotificationId('notif-rec-1');
    assert.equal(stored?.attempts.length, 3);
    assert.equal(stored?.attempts[0]?.status, 'FAILED');
    assert.equal(stored?.attempts[1]?.status, 'FAILED');
    assert.equal(stored?.attempts[2]?.status, 'SUCCESS');
  });

  // CASO 8: Mensaje duplicado -> Idempotencia en Inbox cuando ya esta PROCESSED
  await t.test('CASO 8: Mensaje duplicado ya PROCESSED debe retornar ACK_DUPLICATE sin reenviar PUSH', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    await tokenRepo.upsertToken('usr-dup', 'token-dup', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-dup-1', 'notif-dup-1', 'usr-dup');

    // Primer procesamiento exitoso
    const res1 = await service.processNotificationRequest(envelope);
    assert.equal(res1.actionTaken, 'DELIVERED');
    assert.equal(provider.getSentPushes().length, 1);

    // Segundo procesamiento (Redelivery de RabbitMQ)
    const res2 = await service.processNotificationRequest(envelope);
    assert.equal(res2.actionTaken, 'ACK_DUPLICATE');
    assert.equal(res2.status, 'ALREADY_PROCESSED');
    assert.equal(provider.getSentPushes().length, 1, 'No debe redisparar el push');
  });

  // CASO 9: Dos consumidores concurrentes -> Uno gana claim, el otro detecta LEASE_ACTIVE
  await t.test('CASO 9: Dos consumidores concurrentes compitiendo por el mismo mensaje', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 15 });

    await tokenRepo.upsertToken('usr-race', 'token-race', 'ANDROID');

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-race-1', 'notif-race-1', 'usr-race');

    // Disparar dos consumidores concurrentemente en paralelo
    const [c1, c2] = await Promise.all([
      service.processNotificationRequest(envelope),
      service.processNotificationRequest(envelope),
    ]);

    const results = [c1.actionTaken, c2.actionTaken];
    assert.ok(
      results.includes('DELIVERED'),
      'Exactamente un consumidor debe entregar exitosamente'
    );
    assert.ok(
      results.includes('IGNORED_LEASE_ACTIVE') || results.includes('ACK_DUPLICATE'),
      'El otro consumidor debe detectar lease activo o completado'
    );
    assert.equal(provider.getSentPushes().length, 1, 'Solo debe efectuarse un unico push');
  });

  // CASO 10: Recuperacion de lease huerfano tras caida de un consumidor previo
  await t.test('CASO 10: Recuperacion de lease huerfano (consumidor anterior murio con PENDING)', async () => {
    const inbox = new InMemoryMessagingInboxRepository();
    const deliveryRepo = new InMemoryDeliveryRepository();
    const tokenRepo = new InMemoryDeviceTokenRepository();
    const m2Client = new MockM2PreferencesClient();
    const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

    await tokenRepo.upsertToken('usr-orphan', 'token-orph', 'ANDROID');

    // Simular que un consumidor tomo el mensaje pero expiro su lease (leaseSeconds = -1)
    await inbox.claimMessage('m8.delivery.notification-requested', 'msg-orph-1', 'NotificationRequested', -1);

    const service = new NotificationDeliveryService(inbox, deliveryRepo, tokenRepo, m2Client, provider);
    const envelope = createMockEnvelope('msg-orph-1', 'notif-orph-1', 'usr-orphan');

    const result = await service.processNotificationRequest(envelope);

    assert.equal(result.actionTaken, 'DELIVERED', 'El nuevo consumidor debe recuperar el claim y completar la entrega');
    assert.equal(provider.getSentPushes().length, 1);
  });
});
