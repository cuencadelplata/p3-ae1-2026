import { describe, expect, it, vi } from 'vitest';
import {
  adaptExternalEvent,
  EVENT_TYPE_TO_ROUTING_KEY,
  EventConsumer,
  InMemoryTechnicalInbox,
  NonRetryableMessagingError,
  OutboxPublisher,
  parseEnvelope,
  PostgresOutboxStore,
  PostgresTechnicalInbox,
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

describe('RF8.6 - Adaptadores de Eventos Externos y Contratos (M5/M6/M7)', () => {
  it('debe adaptar un evento externo con snake_case a la convencion M8', () => {
    const externalPayload = {
      eventType: 'trip_completed',
      trip_id: 999,
      producer: 'm6',
    };

    const envelope = adaptExternalEvent(JSON.stringify(externalPayload), 'trip.completed');
    expect(envelope.eventType).toBe('TripCompleted');
    expect(envelope.data['tripId']).toBe('999');
  });

  it('debe mapear driver.offer.accepted y driver.assigned a DriverAssigned', () => {
    const payloadM5 = { trip_id: '500', driver_id: '300' };
    const envelope1 = adaptExternalEvent(JSON.stringify(payloadM5), 'driver.offer.accepted');
    expect(envelope1.eventType).toBe('DriverAssigned');

    const envelope2 = adaptExternalEvent(JSON.stringify(payloadM5), 'driver.assigned');
    expect(envelope2.eventType).toBe('DriverAssigned');
  });

  it('debe mapear driver.arrived a DriverArrived', () => {
    const payload = { trip_id: '500' };
    const envelope = adaptExternalEvent(JSON.stringify(payload), 'driver.arrived');
    expect(envelope.eventType).toBe('DriverArrived');
  });

  it('debe adaptar ride.requested real de M5 sin fabricar tripId', () => {
    const payload = {
      messageId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
      eventType: 'ride.requested',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: 'req_2026_000123',
      producer: 'm5',
      data: {
        rideRequestId: 'req_2026_000123',
        clientUserId: 91,
        origin: { latitude: -34.6037, longitude: -58.3816, address: 'Origen' },
        destination: { latitude: -34.6083, longitude: -58.3712, address: 'Destino' },
        vehicleType: 'AUTO',
        estimatedFare: { amount: 1250, currency: 'ARS' },
        createdAt: '2026-10-04T11:59:59Z',
      },
    };

    const envelope = adaptExternalEvent(JSON.stringify(payload), 'ride.requested');

    expect(envelope.eventType).toBe('TripRequested');
    expect(envelope.correlationId).toBe('req_2026_000123');
    expect(envelope.data['rideRequestId']).toBe('req_2026_000123');
    expect(envelope.data['clientUserId']).toBe(91);
    expect(envelope.data).not.toHaveProperty('tripId');
  });

  it('define ride.requested como routing key canonica de TripRequested', () => {
    expect(EVENT_TYPE_TO_ROUTING_KEY['TripRequested']).toBe('ride.requested');
  });

  it('debe generar messageId deterministico y estable cuando el evento no trae UUID', () => {
    const rawPayload = JSON.stringify({ trip_id: 888, status: 'started' });
    const envelopeA = adaptExternalEvent(rawPayload, 'trip.started');
    const envelopeB = adaptExternalEvent(rawPayload, 'trip.started');

    expect(envelopeA.messageId).toBe(envelopeB.messageId);
    expect(envelopeA.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('debe lanzar NonRetryableMessagingError ante JSON invalido o no objeto', () => {
    expect(() => adaptExternalEvent('texto-invalido-json')).toThrow(NonRetryableMessagingError);
    expect(() => adaptExternalEvent('12345')).toThrow(NonRetryableMessagingError);
  });
});

describe('RF8.6 - Inbox Tecnico, Atomisidad e Idempotencia (UNIQUE(consumerId, messageId))', () => {
  it('debe soportar reclamo atomico (claim) y marcar completado', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const consumerA = 'm8.notifications';
    const messageId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

    const claimedFirst = await inbox.claim(consumerA, messageId, 'TripCompleted');
    expect(claimedFirst).toBe(true);

    const claimedSecond = await inbox.claim(consumerA, messageId, 'TripCompleted');
    expect(claimedSecond).toBe(false);

    await inbox.markAsCompleted(consumerA, messageId);
    expect(await inbox.hasBeenProcessed(consumerA, messageId)).toBe(true);
  });

  it('debe permitir reclamo posterior si se libera el claim por falla', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const consumerA = 'm8.notifications';
    const messageId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

    await inbox.claim(consumerA, messageId, 'TripCompleted');
    await inbox.releaseClaim(consumerA, messageId);

    const claimedAfterRelease = await inbox.claim(consumerA, messageId, 'TripCompleted');
    expect(claimedAfterRelease).toBe(true);
  });

  it('debe apuntar a la tabla messaging.inbox_events en PostgresTechnicalInbox', async () => {
    const mockSql = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    const pgInbox = new PostgresTechnicalInbox(mockSql);

    await pgInbox.claim('consumer1', 'msg1', 'Event1');
    expect(mockSql.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messaging.inbox_events'),
      ['consumer1', 'msg1', 'Event1', 300]
    );

    await pgInbox.markAsCompleted('consumer1', 'msg1');
    expect(mockSql.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE messaging.inbox_events'),
      ['consumer1', 'msg1']
    );
  });
});

describe('RF8.6 - EventConsumer AMQP (ACK, Concurrencia, Retry, DLQ, Publisher Confirms)', () => {
  function createMockConfirmChannel() {
    return {
      ack: vi.fn(),
      publish: vi.fn((_ex: string, _rk: string, _buf: Buffer, _opt: any, cb: (err?: any) => void) => {
        if (typeof cb === 'function') cb();
        return true;
      }),
      consume: vi.fn(),
      cancel: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(true),
    } as any;
  }

  it('debe ejecutar handler, marcar Inbox y hacer ACK ante mensaje valido', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
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

  it('debe prevenir ejecucion duplicada del handler ante entregas concurrentes del mismo mensaje', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
    });

    let executionCount = 0;
    consumer.registerHandler('TripCompleted', async () => {
      executionCount++;
      await new Promise((r) => setTimeout(r, 10));
    });

    const validPayload = {
      messageId: 'concurrent-msg-123',
      eventType: 'TripCompleted',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: '100',
      producer: 'm6',
      data: { tripId: '100' },
    };

    const msg1 = {
      content: Buffer.from(JSON.stringify(validPayload)),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: {} },
    } as any;

    const msg2 = {
      content: Buffer.from(JSON.stringify(validPayload)),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: {} },
    } as any;

    await Promise.all([
      consumer.processMessage(channel, msg1),
      consumer.processMessage(channel, msg2),
    ]);

    expect(executionCount).toBe(1);
    expect(channel.ack).toHaveBeenCalledTimes(2);
  });

  it('debe prevenir ejecucion duplicada para redelivery de ride.requested con mismo messageId', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.notifications',
      topology: { queue: 'm8.notifications.trip-events', routingKey: 'ride.requested' },
      inboxStore: inbox,
    });

    const handler = vi.fn().mockResolvedValue(undefined);
    consumer.registerHandler('TripRequested', handler);

    const payload = {
      messageId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d',
      eventType: 'ride.requested',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: 'req_2026_000123',
      producer: 'm5',
      data: {
        rideRequestId: 'req_2026_000123',
        clientUserId: 91,
        origin: { latitude: -34.6037, longitude: -58.3816, address: 'Origen' },
        destination: { latitude: -34.6083, longitude: -58.3712, address: 'Destino' },
        vehicleType: 'AUTO',
        estimatedFare: { amount: 1250, currency: 'ARS' },
        createdAt: '2026-10-04T11:59:59Z',
      },
    };
    const msg1 = {
      content: Buffer.from(JSON.stringify(payload)),
      fields: { routingKey: 'ride.requested' },
      properties: { headers: {} },
    } as any;
    const msg2 = {
      content: Buffer.from(JSON.stringify(payload)),
      fields: { routingKey: 'ride.requested' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg1);
    await consumer.processMessage(channel, msg2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(2);
  });

  it('debe enviar a DLQ un ride.requested rechazado por validacion de negocio', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.notifications',
      topology: { queue: 'm8.notifications.trip-events', routingKey: 'ride.requested' },
      inboxStore: inbox,
    });

    consumer.registerHandler('TripRequested', async (event) => {
      if (typeof event.data['clientUserId'] !== 'number') {
        throw new NonRetryableMessagingError('data.clientUserId debe ser numerico');
      }
    });

    const payload = {
      messageId: 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6e',
      eventType: 'ride.requested',
      version: 1,
      occurredAt: '2026-10-04T12:00:00Z',
      correlationId: 'req_2026_000124',
      producer: 'm5',
      data: {
        rideRequestId: 'req_2026_000124',
        clientUserId: '91',
      },
    };
    const msg = {
      content: Buffer.from(JSON.stringify(payload)),
      fields: { routingKey: 'ride.requested' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events.dlx',
      'm8.notifications.trip-events',
      msg.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-dlq-reason': 'data.clientUserId debe ser numerico',
        }),
      }),
      expect.any(Function),
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(await inbox.hasBeenProcessed('m8.notifications', payload.messageId)).toBe(false);
  });

  it('debe incrementar retryCount y programar reintento si falla la consulta al Inbox', async () => {
    const failingInbox = {
      claim: vi.fn().mockRejectedValue(new Error('DB Connection Timeout')),
      markAsCompleted: vi.fn(),
      releaseClaim: vi.fn(),
      hasBeenProcessed: vi.fn(),
      markAsProcessed: vi.fn(),
    };

    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: failingInbox,
      maxRetries: 3,
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
      properties: { headers: { 'x-retry-count': 1 } },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith('', 'm8.test-queue.retry', expect.any(Buffer), expect.objectContaining({
      headers: expect.objectContaining({ 'x-retry-count': 2 }),
    }), expect.any(Function));
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('debe enviar directamente a DLQ ante mensaje corrupto o JSON invalido', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = createMockConfirmChannel();
    const consumer = new EventConsumer({
      consumerId: 'm8.test-consumer',
      topology: { queue: 'm8.test-queue', routingKey: 'trip.completed' },
      inboxStore: inbox,
    });

    const msg = {
      content: Buffer.from('contenido-no-json'),
      fields: { routingKey: 'trip.completed' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events.dlx',
      'm8.test-queue',
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-dlq-reason': expect.stringContaining('JSON') }),
      }),
      expect.any(Function)
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });
});

describe('RF8.6 - Publicador Outbox con Publisher Confirms', () => {
  it('debe publicar eventos pendientes y marcarlos publicados tras confirmacion', async () => {
    const outboxStore = {
      fetchPending: vi.fn().mockResolvedValue([
        { id: 'ob-1', eventType: 'ReceiptIssued', payload: { messageId: 'm-1', data: {} } },
      ]),
      markAsPublished: vi.fn().mockResolvedValue(undefined),
      markAsFailed: vi.fn().mockResolvedValue(undefined),
    };

    const channel = {
      publish: vi.fn((_ex: string, _rk: string, _buf: Buffer, _opt: any, cb: (err?: any) => void) => {
        cb();
        return true;
      }),
      waitForConfirms: vi.fn().mockResolvedValue(true),
    } as any;

    const publisher = new OutboxPublisher(outboxStore);
    const count = await publisher.publishPending(channel);

    expect(count).toBe(1);
    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events',
      'receipt.issued',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
      expect.any(Function)
    );
    expect(outboxStore.markAsPublished).toHaveBeenCalledWith('ob-1');
  });

  it('debe soportar claimPending en PostgresOutboxStore con FOR UPDATE SKIP LOCKED', async () => {
    const mockSql = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'ob-99', eventType: 'TripStarted', payload: { messageId: 'm-99' } }],
      }),
    };
    const store = new PostgresOutboxStore(mockSql);
    const result = await store.claimPending(5);

    expect(result.length).toBe(1);
    expect(mockSql.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      [5]
    );
  });
});

describe('RF8.6 - Recuperacion de claims PENDING y Enforcement de Confirms', () => {
  it('debe recuperar un claim PENDING expirado en InMemoryTechnicalInbox', async () => {
    const inbox = new InMemoryTechnicalInbox(50); // 50ms timeout
    const consumer = 'm8.notifications';
    const msgId = 'msg-pending-timeout';

    const first = await inbox.claim(consumer, msgId, 'TripStarted');
    expect(first).toBe(true);

    const immediateSecond = await inbox.claim(consumer, msgId, 'TripStarted');
    expect(immediateSecond).toBe(false);

    // Esperar a que expire el lease
    await new Promise((resolve) => setTimeout(resolve, 60));

    const afterExpired = await inbox.claim(consumer, msgId, 'TripStarted');
    expect(afterExpired).toBe(true);
  });

  it('debe rechazar publicar si el canal no soporta Publisher Confirms', async () => {
    const invalidChannel = {
      publish: vi.fn(), // sin callback (4 params) y sin waitForConfirms
    } as any;

    const inbox = new InMemoryTechnicalInbox();
    const consumer = new EventConsumer({
      consumerId: 'm8.test',
      topology: { queue: 'q', routingKey: 'rk' },
      inboxStore: inbox,
    });

    const msg = {
      content: Buffer.from('invalid'),
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
    } as any;

    // processMessage intentara enviar a DLQ con publishWithConfirm, el cual fallara por falta de ConfirmChannel
    await expect(consumer.processMessage(invalidChannel, msg)).rejects.toThrow('ConfirmChannel');
  });

  it('debe enviar a DLQ cuando llega un eventType desconocido o sin handler registrado', async () => {
    const inbox = new InMemoryTechnicalInbox();
    const channel = {
      ack: vi.fn(),
      publish: vi.fn((_ex: string, _rk: string, _buf: Buffer, _opt: any, cb: (err?: any) => void) => {
        if (typeof cb === 'function') cb();
        return true;
      }),
      waitForConfirms: vi.fn().mockResolvedValue(true),
    } as any;

    const consumer = new EventConsumer({
      consumerId: 'm8.test',
      topology: { queue: 'q', routingKey: 'rk' },
      inboxStore: inbox,
    });

    const msg = {
      content: Buffer.from(JSON.stringify({
        messageId: 'b1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        eventType: 'EventoInexistente',
        version: 1,
        occurredAt: new Date().toISOString(),
        correlationId: '123',
        producer: 'test',
        data: {},
      })),
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
    } as any;

    await consumer.processMessage(channel, msg);

    expect(channel.publish).toHaveBeenCalledWith(
      'mobility.events.dlx',
      'q',
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-dlq-reason': expect.stringContaining('Sin handler') }),
      }),
      expect.any(Function)
    );
  });
});
