import { describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import {
  M3DriverDocumentConsumer,
  validateAndAdaptM3Envelope,
  M3_EXCHANGE,
  M3_QUEUE,
  M3_ROUTING_KEY,
  M3_EVENT_TYPE,
  M3_CONSUMER_ID,
} from '../../src/messaging/m3-consumer';
import type { TechnicalInboxStore } from '../../src/messaging/inbox';

function createMockInboxStore(): TechnicalInboxStore & { claims: Map<string, string>; completed: Set<string> } {
  const claims = new Map<string, string>();
  const completed = new Set<string>();

  return {
    claims,
    completed,
    async claim(consumerId: string, messageId: string) {
      const key = `${consumerId}:${messageId}`;
      if (claims.has(key)) return false;
      claims.set(key, 'PENDING');
      return true;
    },
    async markAsCompleted(consumerId: string, messageId: string) {
      const key = `${consumerId}:${messageId}`;
      claims.set(key, 'COMPLETED');
      completed.add(key);
    },
    async releaseClaim(consumerId: string, messageId: string) {
      const key = `${consumerId}:${messageId}`;
      claims.delete(key);
    },
  };
}

function createMockChannel() {
  let messageConsumer: ((msg: ConsumeMessage | null) => void) | undefined;

  const channel = {
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({}),
    bindQueue: vi.fn().mockResolvedValue({}),
    consume: vi.fn((queue: string, onMessage: (msg: ConsumeMessage | null) => void) => {
      messageConsumer = onMessage;
      return Promise.resolve({ consumerTag: 'test-consumer-tag' });
    }),
    cancel: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn((_exchange, _routingKey, _content, _options, cb) => {
      if (typeof cb === 'function') cb(null);
      return true;
    }),
    simulateIncomingMessage: (msg: ConsumeMessage) => {
      if (messageConsumer) {
        messageConsumer(msg);
      }
    },
  };

  return channel;
}

function createRawM3Message(overrides = {}): ConsumeMessage {
  const payload = {
    messageId: 'b7c3d2e1-4a5f-4e6b-8c9d-0e1f2a3b4c5d',
    eventType: 'DriverDocumentRegistered',
    version: 1,
    occurredAt: '2026-10-11T23:04:00.000Z',
    correlationId: 'doc-uuid-999',
    producer: 'm3-conductores',
    data: {
      documentId: 'doc-uuid-999',
      driverId: 42,
      tipoDocumento: 'LICENCIA',
    },
    ...overrides,
  };

  return {
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: M3_EXCHANGE,
      routingKey: M3_ROUTING_KEY,
      consumerTag: 'test-consumer-tag',
    },
    properties: {
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      headers: {},
      deliveryMode: 2,
      priority: 0,
      correlationId: 'doc-uuid-999',
      messageId: payload.messageId,
    },
    content: Buffer.from(JSON.stringify(payload)),
  } as unknown as ConsumeMessage;
}

describe('RF8.6 - M3DriverDocumentConsumer', () => {
  it('1. el exchange, cola y binding se configuran correctamente', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    const rf81Handler = vi.fn().mockResolvedValue({ status: 'SUCCESS_CREATED', valid: true });

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
    });

    await consumer.start();

    expect(channel.assertExchange).toHaveBeenCalledWith(M3_EXCHANGE, 'topic', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith(
      M3_QUEUE,
      expect.objectContaining({ durable: true })
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(M3_QUEUE, M3_EXCHANGE, M3_ROUTING_KEY);
    expect(channel.consume).toHaveBeenCalledWith(M3_QUEUE, expect.any(Function), { noAck: false });

    await consumer.stop();
    expect(channel.cancel).toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalled();
  });

  it('2. un evento válido de M3 llega a RF8.1 y se confirma con ACK', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    const rf81Handler = vi.fn().mockResolvedValue({ status: 'SUCCESS_CREATED', valid: true });

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
    });

    await consumer.start();

    const incoming = createRawM3Message();
    channel.simulateIncomingMessage(incoming);

    // Permitir resolución de promises asíncronas
    await new Promise((r) => setTimeout(r, 50));

    expect(rf81Handler).toHaveBeenCalledTimes(1);
    expect(rf81Handler).toHaveBeenCalledWith({
      messageId: 'b7c3d2e1-4a5f-4e6b-8c9d-0e1f2a3b4c5d',
      eventType: 'DriverDocumentRegistered',
      documentId: 'doc-uuid-999',
      driverId: 42,
      tipoDocumento: 'LICENCIA',
      correlationId: 'doc-uuid-999',
      occurredAt: '2026-10-11T23:04:00.000Z',
    });

    expect(inbox.completed.has(`${M3_CONSUMER_ID}:b7c3d2e1-4a5f-4e6b-8c9d-0e1f2a3b4c5d`)).toBe(true);
    expect(channel.ack).toHaveBeenCalledWith(incoming);

    await consumer.stop();
  });

  it('3. el mismo messageId no se procesa dos veces (Inbox e idempotencia técnica)', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    const rf81Handler = vi.fn().mockResolvedValue({ status: 'SUCCESS_CREATED', valid: true });

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
    });

    await consumer.start();

    const incoming = createRawM3Message();
    channel.simulateIncomingMessage(incoming);
    await new Promise((r) => setTimeout(r, 50));

    expect(rf81Handler).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);

    // Segundo envío con mismo messageId (redelivery)
    channel.simulateIncomingMessage(incoming);
    await new Promise((r) => setTimeout(r, 50));

    // RF8.1 NO debe ser invocado por segunda vez; se responde ACK para limpiar el redelivery
    expect(rf81Handler).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(2);

    await consumer.stop();
  });

  it('4. un evento inválido no derriba el consumidor y es enviado a DLQ', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    const rf81Handler = vi.fn();

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
    });

    await consumer.start();

    // Evento con driverId UUID no numérico (incumple contrato M1 canónico)
    const invalidMsg = createRawM3Message({
      data: {
        documentId: 'doc-123',
        driverId: 'uuid-invalido',
        tipoDocumento: 'LICENCIA',
      },
    });

    channel.simulateIncomingMessage(invalidMsg);
    await new Promise((r) => setTimeout(r, 50));

    // No debe haber llegado a RF8.1
    expect(rf81Handler).not.toHaveBeenCalled();

    // Se publica a DLQ y se hace ACK del mensaje corrupto de la cola principal
    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events.dlx',
      M3_QUEUE,
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-dlq-reason': expect.stringContaining('driverId debe ser un entero positivo'),
        }),
      }),
      expect.any(Function)
    );
    expect(channel.ack).toHaveBeenCalledWith(invalidMsg);

    await consumer.stop();
  });

  it('5. error en RF8.1 respeta retry/DLQ según corresponda', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    // Simular error de persistencia transitorio en RF8.1
    const rf81Handler = vi.fn().mockResolvedValue({
      status: 'PERSISTENCE_FAILURE',
      valid: false,
      error: new Error('Postgres connection pool exhausted'),
    });

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
      maxRetries: 3,
      retryDelayMs: 200,
    });

    await consumer.start();

    const msg = createRawM3Message();
    channel.simulateIncomingMessage(msg);
    await new Promise((r) => setTimeout(r, 50));

    // Se programa reintento en la cola de retry
    expect(channel.publish).toHaveBeenCalledWith(
      '',
      `${M3_QUEUE}.retry`,
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-retry-count': 1,
        }),
      }),
      expect.any(Function)
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);

    await consumer.stop();
  });

  it('6. el consumidor continúa procesando mensajes posteriores tras un error', async () => {
    const channel = createMockChannel();
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn(),
    } as unknown as ChannelModel;

    const inbox = createMockInboxStore();
    const rf81Handler = vi.fn()
      .mockRejectedValueOnce(new Error('Fallo aislado'))
      .mockResolvedValueOnce({ status: 'SUCCESS_CREATED', valid: true });

    const consumer = new M3DriverDocumentConsumer({
      connection,
      inboxStore: inbox,
      rf81Handler,
    });

    await consumer.start();

    const id1 = 'c1c1c1c1-4a5f-4e6b-8c9d-0e1f2a3b4c5d';
    const id2 = 'd2d2d2d2-4a5f-4e6b-8c9d-0e1f2a3b4c5d';
    const msg1 = createRawM3Message({ messageId: id1 });
    const msg2 = createRawM3Message({ messageId: id2 });

    channel.simulateIncomingMessage(msg1);
    await new Promise((r) => setTimeout(r, 50));

    channel.simulateIncomingMessage(msg2);
    await new Promise((r) => setTimeout(r, 50));

    expect(rf81Handler).toHaveBeenCalledTimes(2);
    expect(inbox.completed.has(`${M3_CONSUMER_ID}:${id2}`)).toBe(true);
    expect(channel.ack).toHaveBeenCalledWith(msg2);

    await consumer.stop();
  });
});
