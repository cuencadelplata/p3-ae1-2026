import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service.js';
import { InMemoryMessagingInboxRepository } from '../../src/infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../../src/infrastructure/database/delivery.repository.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';
import { MockM2PreferencesClient } from '../../src/infrastructure/clients/m2-preferences.client.js';
import { SandboxPushProvider } from '../../src/infrastructure/provider/sandbox-push-provider.js';
import {
  validateNotificationRequestedEnvelope,
  ContractValidationError,
} from '../../src/domain/notification-requested.contract.js';
import type { NotificationRequestedEnvelope } from '../../src/domain/delivery.types.js';

function createDriverDocumentEnvelope(
  messageId: string = 'msg-doc-001',
  notificationId: string = 'notif-doc-001',
  driverId: number = 42,
  correlationId: string = 'doc-uuid-42'
): NotificationRequestedEnvelope {
  return {
    messageId,
    eventType: 'NotificationRequested',
    version: 1,
    occurredAt: '2026-10-11T23:04:00.000Z',
    correlationId,
    producer: 'm8-notifications',
    data: {
      notificationId,
      recipientId: driverId,
      eventType: 'DRIVER_DOCUMENT_REGISTERED',
      channel: 'PUSH',
      title: 'Documento registrado',
      message: 'Tu documento fue registrado correctamente.',
      createdAt: '2026-10-11T23:04:00.000Z',
    },
  };
}

test('RF8.7 — Entrega PUSH para Notificación de Documento Registrado', async (t) => {
  // PRUEBA 1: Una solicitud de entrega con driverId numérico busca dispositivos del conductor correcto
  await t.test(
    '1. Una solicitud de entrega con driverId numérico busca dispositivos del conductor correcto',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

      const driverId = 42;
      const otherUserId = 99;

      // Dispositivo registrado para el conductor 42
      await tokenRepo.upsertToken(driverId, 'fcm_token_driver_42', 'ANDROID');
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      // Dispositivo registrado para otro usuario 99
      await tokenRepo.upsertToken(otherUserId, 'fcm_token_other_99', 'IOS');
      m2Client.setPreferences(otherUserId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider
      );
      const envelope = createDriverDocumentEnvelope('msg-p1', 'notif-p1', driverId);

      const result = await service.processNotificationRequest(envelope);

      assert.equal(result.actionTaken, 'DELIVERED');
      assert.equal(provider.getSentPushes().length, 1);
      const sentPush = provider.getSentPushes()[0];
      assert.equal(sentPush?.recipientId, driverId, 'El destinatario del push debe ser el conductor');
      assert.equal(
        sentPush?.deviceToken,
        'fcm_token_driver_42',
        'Debe utilizar el token del conductor y no el de otro usuario'
      );
    }
  );

  // PRUEBA 2: Con dispositivo registrado se intenta el PUSH
  await t.test(
    '2. Con dispositivo registrado se intenta el PUSH',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

      const driverId = 42;
      await tokenRepo.upsertToken(driverId, 'fcm_token_driver_active', 'ANDROID');
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider
      );
      const envelope = createDriverDocumentEnvelope('msg-p2', 'notif-p2', driverId);

      const result = await service.processNotificationRequest(envelope);

      assert.equal(result.actionTaken, 'DELIVERED');
      assert.equal(result.status, 'DELIVERED');
      assert.equal(result.attemptsCount, 1);
      assert.equal(provider.getSentPushes().length, 1);

      const push = provider.getSentPushes()[0];
      assert.equal(push?.recipientId, driverId);
      assert.equal(push?.deviceToken, 'fcm_token_driver_active');
      assert.equal(push?.title, 'Documento registrado');
      assert.equal(push?.body, 'Tu documento fue registrado correctamente.');
      assert.equal(push?.correlationId, 'doc-uuid-42');
    }
  );

  // PRUEBA 3: Una redelivery no genera un segundo PUSH exitoso innecesario
  await t.test(
    '3. Una redelivery no genera un segundo PUSH exitoso innecesario',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

      const driverId = 42;
      await tokenRepo.upsertToken(driverId, 'fcm_token_driver_idemp', 'ANDROID');
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider
      );
      const envelope = createDriverDocumentEnvelope('msg-p3-dup', 'notif-p3-dup', driverId);

      // Primer procesamiento exitoso
      const firstResult = await service.processNotificationRequest(envelope);
      assert.equal(firstResult.actionTaken, 'DELIVERED');
      assert.equal(provider.getSentPushes().length, 1);

      // Segundo procesamiento (redelivery con mismo messageId)
      const secondResult = await service.processNotificationRequest(envelope);
      assert.equal(secondResult.actionTaken, 'ACK_DUPLICATE');
      assert.equal(secondResult.status, 'ALREADY_PROCESSED');
      assert.equal(secondResult.attemptsCount, 0);
      assert.equal(
        provider.getSentPushes().length,
        1,
        'No debe generarse un segundo PUSH ante un mensaje duplicado'
      );
    }
  );

  // PRUEBA 4: Sin dispositivo se conserva el comportamiento esperado
  await t.test(
    '4. Sin dispositivo se conserva el comportamiento esperado (FAILED_NO_DEVICE_TOKEN)',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

      const driverId = 42;
      // No registramos ningún token para el conductor 42
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider
      );
      const envelope = createDriverDocumentEnvelope('msg-p4-notoken', 'notif-p4-notoken', driverId);

      const result = await service.processNotificationRequest(envelope);

      assert.equal(result.actionTaken, 'FAILED');
      assert.equal(result.status, 'FAILED_NO_DEVICE_TOKEN');
      assert.equal(result.skipReason, 'NO_ACTIVE_DEVICE_TOKEN');
      assert.equal(result.attemptsCount, 0);
      assert.equal(provider.getSentPushes().length, 0, 'No debe intentar enviar PUSH');

      // Se marca PROCESSED en Inbox para ACK técnico y evitar poison message loop
      const inboxRec = await inbox.getRecord('m8.delivery.notification-requested', 'msg-p4-notoken');
      assert.equal(inboxRec?.status, 'PROCESSED');

      // Auditoría en repositorio
      const stored = await service.getDeliveryByNotificationId('notif-p4-notoken');
      assert.equal(stored?.status, 'FAILED_NO_DEVICE_TOKEN');
      assert.equal(stored?.skipReason, 'NO_ACTIVE_DEVICE_TOKEN');
    }
  );

  // PRUEBA 5: Ante fallo del proveedor se aplican los reintentos definidos
  await t.test(
    '5. Ante fallo del proveedor se aplican los reintentos definidos (3 intentos y DLQ)',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'FAIL_ALWAYS', simulatedDelayMs: 0 });

      const driverId = 42;
      await tokenRepo.upsertToken(driverId, 'fcm_token_fail', 'ANDROID');
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider,
        {
          maxAttempts: 3,
          initialBackoffMs: 1,
        }
      );
      const envelope = createDriverDocumentEnvelope('msg-p5-fail', 'notif-p5-fail', driverId);

      const result = await service.processNotificationRequest(envelope);

      assert.equal(result.actionTaken, 'FAILED');
      assert.equal(result.status, 'FAILED');
      assert.equal(result.attemptsCount, 3);
      assert.equal(provider.getSentPushes().length, 3, 'Debe haber ejecutado exactamente 3 intentos');

      // En Inbox queda FAILED para derivación a DLQ
      const inboxRec = await inbox.getRecord('m8.delivery.notification-requested', 'msg-p5-fail');
      assert.equal(inboxRec?.status, 'FAILED');

      // En repositorio se auditan los 3 intentos fallidos
      const stored = await service.getDeliveryByNotificationId('notif-p5-fail');
      assert.equal(stored?.status, 'FAILED');
      assert.equal(stored?.attempts.length, 3);
      assert.ok(stored?.attempts.every((att) => att.status === 'FAILED'));
    }
  );

  // PRUEBA 6: El resultado de delivery queda registrado según las reglas actuales
  await t.test(
    '6. El resultado de delivery queda registrado según las reglas actuales',
    async () => {
      const inbox = new InMemoryMessagingInboxRepository();
      const deliveryRepo = new InMemoryDeliveryRepository();
      const tokenRepo = new InMemoryDeviceTokenRepository();
      const m2Client = new MockM2PreferencesClient();
      const provider = new SandboxPushProvider({ mode: 'NORMAL', simulatedDelayMs: 0 });

      const driverId = 42;
      await tokenRepo.upsertToken(driverId, 'fcm_token_driver_audit', 'ANDROID');
      m2Client.setPreferences(driverId, { notificationsEnabled: true, pushEnabled: true });

      const service = new NotificationDeliveryService(
        inbox,
        deliveryRepo,
        tokenRepo,
        m2Client,
        provider
      );
      const envelope = createDriverDocumentEnvelope('msg-p6-audit', 'notif-p6-audit', driverId);

      await service.processNotificationRequest(envelope);

      const stored = await service.getDeliveryByNotificationId('notif-p6-audit');
      assert.ok(stored, 'El registro de entrega debe existir en la base de datos');
      assert.equal(stored?.notificationId, 'notif-p6-audit');
      assert.equal(stored?.messageId, 'msg-p6-audit');
      assert.equal(stored?.userId, driverId);
      assert.equal(stored?.eventType, 'DRIVER_DOCUMENT_REGISTERED');
      assert.equal(stored?.channel, 'PUSH');
      assert.equal(stored?.status, 'DELIVERED');
      assert.equal(stored?.title, 'Documento registrado');
      assert.equal(stored?.message, 'Tu documento fue registrado correctamente.');
      assert.equal(stored?.deviceToken, 'fcm_token_driver_audit');
      assert.equal(stored?.attempts.length, 1);
      assert.equal(stored?.attempts[0]?.status, 'SUCCESS');
      assert.equal(stored?.attempts[0]?.attemptNumber, 1);
      assert.ok(stored?.attempts[0]?.providerResponse?.startsWith('sandbox-fcm-'));
      assert.ok(typeof stored?.attempts[0]?.latencyMs === 'number');
    }
  );

  // PRUEBA ADICIONAL: Rechazo estricto si driverId no es el userId numérico canónico de M1
  await t.test(
    '7. Regla de seguridad e identidad: No asumir UUID de M3 como destinatario (falla contrato si no es userId numérico)',
    () => {
      const envelopeWithUuidDriver = {
        messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
        eventType: 'NotificationRequested',
        version: 1,
        occurredAt: '2026-10-11T23:04:00.000Z',
        correlationId: 'doc-uuid-42',
        producer: 'm8-notifications',
        data: {
          notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
          recipientId: 'c8f1e63a-4a25-4c07-b64d-5c8e763131bf', // UUID de M3 rechazado
          eventType: 'DRIVER_DOCUMENT_REGISTERED',
          channel: 'PUSH',
          message: 'Tu documento fue registrado correctamente.',
          createdAt: '2026-10-11T23:04:00.000Z',
        },
      };

      assert.throws(
        () => validateNotificationRequestedEnvelope(envelopeWithUuidDriver),
        ContractValidationError
      );
    }
  );
});
