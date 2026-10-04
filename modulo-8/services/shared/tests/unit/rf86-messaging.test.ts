import { describe, expect, it, vi } from 'vitest';
import {
  adaptExternalEvent,
  EventConsumer,
  InMemoryTechnicalInbox,
  NonRetryableMessagingError,
  parseEnvelope,
} from '../../src';

describe('RF8.6 - Validador de Envelope M8', () => {
  it('debe validar exitosamente un sobre canonico M8 correcto', () => {
    const validPayload = {
      messageId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: '12345',
      producer: 'm6',
      data: { tripId: '12345' },
    };

    const res = parseEnvelope(JSON.stringify(validPayload));
    expect(res.ok).toBe(true);
    expect(res.value?.eventType).toBe('TripCompleted');
  });

  it('debe rechazar sobre con messageId que no es UUID', () => {
    const invalidPayload = {
      messageId: 'no-es-uuid',
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: '123',
      producer: 'm6',
      data: {},
    };

    const res = parseEnvelope(JSON.stringify(invalidPayload));
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('messageId debe ser un UUID valido');
  });

  it('debe rechazar sobre con occurredAt invalido', () => {
    const invalidPayload = {
      messageId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: 'fecha-invalida',
      correlationId: '123',
      producer: 'm6',
      data: {},
    };

    const res = parseEnvelope(JSON.stringify(invalidPayload));
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('occurredAt debe ser una fecha ISO 8601 valida');
  });
});

describe('RF8.6 - Adaptadores de Eventos Externos (M5/M6/M7)', () => {
  it('debe adaptar un evento externo con snake_case a la convencion M8', () => {
    const externalPayload = {
      eventType: 'trip_completed',
      trip_id: 999,
      producer: 'm6',
    };

    const envelope = adaptExternalEvent(JSON.stringify(externalPayload), 'trip.completed');
    expect(envelope.eventType).toBe('TripCompleted');
    expect(envelope.data['tripId']).toBe('999');
    expect(envelope.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('RF8.6 - Inbox Tecnico e Idempotencia (UNIQUE(consumerId, messageId))', () => {
  it('debe registrar y evitar duplicados por consumidor', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const consumerA = 'm8.notifications';
    const consumerB = 'm8.receipts';
    const messageId = 'msg-uuid-100';

    expect(await inbox.hasBeenProcessed(consumerA, messageId)).toBe(false);
    await inbox.markAsProcessed(consumerA, messageId, 'TripCompleted');
    expect(await inbox.hasBeenProcessed(consumerA, messageId)).toBe(true);

    // UNIQUE(consumerId, messageId) -> Consumer B no se ve afectado por el consumo de Consumer A
    expect(await inbox.hasBeenProcessed(consumerB, messageId)).toBe(false);
  });
});

describe('RF8.6 - EventConsumer AMQP (ACK, Retry, DLQ)', () => {
  function createMockChannel() {
    return {
      ack: vi.fn(),
      publish: vi.fn(),
      consume: vi.fn(),
      cancel: vi.fn(),
    } as any;
  }

  it('debe ejecutar handler, marcar Inbox y hacer ACK ante mensaje valido', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
    });

    const handler = vi.fn().mockResolvedValue(undefined);
    consumer.registerHandler('TripCompleted', handler);

    const validPayload = {
      messageId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: '100',
      producer: 'm6',
      data: { tripId: '100' },
    };

    const msg = {
      content: Buffer.from(JSON.stringify(validPayload)),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(await inbox.hasBeenProcessed('m8.test-consumer', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d')).toBe(true);
  });

  it('debe programar reintento a la cola retry ante falla recuperable (hasta 3 intentos)', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
      maxRetries: 3,
      retryDelayMs: 1000,
    });

    consumer.registerHandler('TripCompleted', async () => {
      throw new Error('Fallo transitorio de DB');
    });

    const msg = {
      content: Buffer.from(JSON.stringify({
        messageId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        eventType: 'TripCompleted',
        version: 1,
        occurredAt: '2026-10-04T12:00:00Z',
        correlationId: '100',
        producer: 'm6',
        data: {},
      })),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: { 'x-retry-count': 0 } },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith('', 'm8.test-queue.retry', expect.any(Buffer), expect.objectContaining({
      headers: expect.objectContaining({ 'x-retry-count': 1 }),
      expiration: '1000',
    }));
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('debe desviar a DLQ si supera el maximo de 3 reintentos', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
      maxRetries: 3,
    });

    consumer.registerHandler('TripCompleted', async () => {
      throw new Error('Fallo continuo');
    });

    const msg = {
      content: Buffer.from(JSON.stringify({
        messageId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        eventType: 'TripCompleted',
        version: 1,
        occurredAt: '2026-10-04T12:00:00Z',
        correlationId: '100',
        producer: 'm6',
        data: {},
      })),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: { 'x-retry-count': 3 } },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith('mobility.events.dlx', 'm8.test-queue', expect.any(Buffer), expect.objectContaining({
      headers: expect.objectContaining({ 'x-dlq-reason': 'Error: Fallo continuo' }),
    }));
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });
});
