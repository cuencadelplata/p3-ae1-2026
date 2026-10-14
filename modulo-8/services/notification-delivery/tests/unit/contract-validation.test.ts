import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNotificationRequestedEnvelope,
  ContractValidationError,
} from '../../src/domain/notification-requested.contract.js';

test('Validador de Contrato NotificationRequested', async (t) => {
  await t.test('debe validar exitosamente un envelope completo y conforme al contrato', () => {
    const raw = {
      messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 91,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        title: 'Viaje iniciado',
        message: 'Tu viaje ha comenzado.',
        targetDestination: 'fcm_token_device_abc123',
        priority: 'HIGH',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    const validated = validateNotificationRequestedEnvelope(raw);

    assert.equal(validated.messageId, '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a');
    assert.equal(validated.eventType, 'NotificationRequested');
    assert.equal(validated.version, 1);
    assert.equal(validated.data.notificationId, 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d');
    assert.equal(validated.data.recipientId, 91);
    assert.equal(validated.data.channel, 'PUSH');
    assert.equal(validated.data.priority, 'HIGH');
  });

  await t.test('debe rechazar un recipientId no numerico o menor a 1', () => {
    const rawString = {
      messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 'usr-0091',
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope(rawString),
      ContractValidationError
    );

    const rawZero = {
      ...rawString,
      data: { ...rawString.data, recipientId: 0 },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope(rawZero),
      ContractValidationError
    );
  });

  await t.test('debe rechazar un mensaje sin messageId', () => {
    const raw = {
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 91,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope(raw),
      ContractValidationError
    );
  });

  await t.test('debe rechazar un eventType distinto de NotificationRequested', () => {
    const raw = {
      messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
      eventType: 'UnknownEvent',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 91,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope(raw),
      ContractValidationError
    );
  });

  await t.test('debe rechazar un canal que no sea PUSH', () => {
    const raw = {
      messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 91,
        eventType: 'TRIP_STARTED',
        channel: 'SMS',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope(raw),
      ContractValidationError
    );
  });

  await t.test('debe rechazar UUID inválidos, propiedades adicionales y prioridades fuera del contrato', () => {
    const valid = {
      messageId: '7c9e1d2a-8b3f-4e5c-9d0a-1f2e3d4c5b6a',
      eventType: 'NotificationRequested',
      version: 1,
      occurredAt: '2026-10-05T18:42:12.500Z',
      correlationId: 'trip-2026-000123',
      producer: 'm8-notifications',
      data: {
        notificationId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
        tripId: 'trip-2026-000123',
        recipientId: 91,
        eventType: 'TRIP_STARTED',
        channel: 'PUSH',
        message: 'Tu viaje ha comenzado.',
        createdAt: '2026-10-05T18:42:12.000Z',
      },
    };

    assert.throws(
      () => validateNotificationRequestedEnvelope({ ...valid, messageId: 'not-a-uuid' }),
      ContractValidationError
    );
    assert.throws(
      () => validateNotificationRequestedEnvelope({ ...valid, unexpected: true }),
      ContractValidationError
    );
    assert.throws(
      () => validateNotificationRequestedEnvelope({
        ...valid,
        data: { ...valid.data, priority: 'URGENT' },
      }),
      ContractValidationError
    );
  });
});
