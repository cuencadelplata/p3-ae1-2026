import { describe, expect, it, vi } from 'vitest';

import { createEventEnvelope } from '../../src/messaging/event-envelope.js';
import type { EventPublisher } from '../../src/messaging/event-publisher.js';
import { OutboxProcessor } from '../../src/messaging/outbox.processor.js';
import type { OutboxRepository } from '../../src/messaging/outbox.repository.js';
import {
  IdempotentEventHandler,
  type ProcessedEventRepository,
} from '../../src/messaging/processed-event.repository.js';

const event = createEventEnvelope({
  eventType: 'reservation.created.v1',
  correlationId: 'correlation-1',
  aggregateId: 'reserva-1',
  payload: { ok: true },
});

describe('infraestructura de mensajería', () => {
  it('crea un envelope versionado y correlacionado', () => {
    expect(event).toMatchObject({
      eventType: 'reservation.created.v1',
      eventVersion: 1,
      correlationId: 'correlation-1',
      aggregateId: 'reserva-1',
    });
    expect(event.eventId).toBeTruthy();
  });

  it('publica Outbox y marca PUBLISHED tras confirmación', async () => {
    const repository = {
      findPending: vi
        .fn()
        .mockResolvedValue([
          { id: 'outbox-1', routingKey: 'provisional.test', event, status: 'PENDING', attempts: 0 },
        ]),
      markPublished: vi.fn(),
      markFailed: vi.fn(),
      scheduleRetry: vi.fn(),
    } satisfies OutboxRepository;
    const publisher = {
      publish: vi.fn().mockResolvedValue(undefined),
      publishToDeadLetter: vi.fn(),
    } satisfies EventPublisher;

    await new OutboxProcessor(repository, publisher, 3, 0).process();
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(repository.markPublished).toHaveBeenCalledWith('outbox-1');
  });

  it('incrementa retry y envía a DLQ al alcanzar el límite', async () => {
    const repository = {
      findPending: vi
        .fn()
        .mockResolvedValue([
          { id: 'outbox-1', routingKey: 'provisional.test', event, status: 'PENDING', attempts: 2 },
        ]),
      markPublished: vi.fn(),
      markFailed: vi.fn(),
      scheduleRetry: vi.fn(),
    } satisfies OutboxRepository;
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('down')),
      publishToDeadLetter: vi.fn().mockResolvedValue(undefined),
    } satisfies EventPublisher;

    await new OutboxProcessor(repository, publisher, 3, 0).process();
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(publisher.publishToDeadLetter).toHaveBeenCalledOnce();
    expect(repository.markFailed).toHaveBeenCalledWith('outbox-1', 'Error');
  });

  it('programa un nuevo intento con backoff antes de agotar el límite', async () => {
    const repository = {
      findPending: vi.fn().mockResolvedValue([
        {
          id: 'outbox-1',
          routingKey: 'reservation.created.v1',
          event,
          status: 'PENDING',
          attempts: 0,
        },
      ]),
      markPublished: vi.fn(),
      markFailed: vi.fn(),
      scheduleRetry: vi.fn(),
    } satisfies OutboxRepository;
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('down')),
      publishToDeadLetter: vi.fn(),
    } satisfies EventPublisher;

    await new OutboxProcessor(repository, publisher, 3, 10).process();
    expect(repository.scheduleRetry).toHaveBeenCalledWith('outbox-1', expect.any(Date), 'Error');
    expect(publisher.publishToDeadLetter).not.toHaveBeenCalled();
  });

  it('mantiene PENDING si tampoco puede confirmar la publicación en DLQ', async () => {
    const repository = {
      findPending: vi.fn().mockResolvedValue([
        {
          id: 'outbox-1',
          routingKey: 'reservation.created.v1',
          event,
          status: 'PENDING',
          attempts: 2,
        },
      ]),
      markPublished: vi.fn(),
      markFailed: vi.fn(),
      scheduleRetry: vi.fn(),
    } satisfies OutboxRepository;
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('main down')),
      publishToDeadLetter: vi.fn().mockRejectedValue(new TypeError('dlq down')),
    } satisfies EventPublisher;

    await new OutboxProcessor(repository, publisher, 3, 10).process();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.scheduleRetry).toHaveBeenCalledWith(
      'outbox-1',
      expect.any(Date),
      'TypeError',
    );
  });

  it('evita repetir un efecto con el mismo eventId', async () => {
    const processed = new Set<string>();
    const repository: ProcessedEventRepository = {
      hasProcessed: async (id) => processed.has(id),
      markProcessed: async (id) => {
        processed.add(id);
      },
    };
    const action = vi.fn().mockResolvedValue(undefined);
    const handler = new IdempotentEventHandler(repository);
    expect(await handler.handle(event.eventId, action)).toBe(true);
    expect(await handler.handle(event.eventId, action)).toBe(false);
    expect(action).toHaveBeenCalledOnce();
  });
});
