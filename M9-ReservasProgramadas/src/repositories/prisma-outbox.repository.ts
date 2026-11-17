import type { PrismaClient } from '@prisma/client';

import { parseEventEnvelope } from '../messaging/event-envelope.js';
import type { OutboxMessage, OutboxRepository } from '../messaging/outbox.repository.js';
import { measureDb } from '../observability/db.js';

const toTraceContext = (value: unknown): Record<string, string> | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length === 0 ? null : Object.fromEntries(entries);
};

export class PrismaOutboxRepository implements OutboxRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findPending(limit: number): Promise<OutboxMessage[]> {
    const messages = await measureDb('outbox.find_pending', () =>
      this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    );
    return messages.map((message) => ({
      id: message.id,
      routingKey: message.routingKey,
      event: parseEventEnvelope(message.payload),
      status: message.status,
      attempts: message.attempts,
      traceContext: toTraceContext(message.traceContext),
    }));
  }

  public async markPublished(id: string): Promise<void> {
    await measureDb('outbox.mark_published', () =>
      this.prisma.outboxEvent.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
      }),
    );
  }

  public async markFailed(id: string, error: string): Promise<void> {
    await measureDb('outbox.mark_failed', () =>
      this.prisma.outboxEvent.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: error },
      }),
    );
  }

  public async scheduleRetry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    await measureDb('outbox.schedule_retry', () =>
      this.prisma.outboxEvent.updateMany({
        where: { id, status: 'PENDING' },
        data: { attempts: { increment: 1 }, nextAttemptAt, lastError: error },
      }),
    );
  }
}
